# backend/translator_agent.py

import asyncio
from google.cloud import speech, texttospeech, translate_v2 as translate

# --- Configuration ---
AUDIO_ENCODING = speech.RecognitionConfig.AudioEncoding.LINEAR16
SAMPLE_RATE_HERTZ = 16000

class RealTimeTranslator:
    """
    Orchestrates the real-time translation process for a single WebSocket connection,
    acting as the core AI agent for the STT -> MT -> TTS pipeline.
    """
    def __init__(self, websocket, source_lang, target_lang):
        self._websocket = websocket
        self._source_lang = source_lang
        self._target_lang = target_lang
        self._target_lang_code = target_lang.split('-')[0] # e.g., 'en' from 'en-US'
        
        self._stt_config = self._create_stt_config(source_lang)
        self._translation_queue = asyncio.Queue()
        self._stt_stream = None
        
        # Google Cloud clients are thread-safe and can be reused
        self._speech_client = speech.SpeechClient()
        self._translate_client = translate.Client()
        self._tts_client = texttospeech.TextToSpeechClient()

    def _create_stt_config(self, lang_code):
        """Creates the configuration for the Speech-to-Text API."""
        return speech.RecognitionConfig(
            encoding=AUDIO_ENCODING,
            sample_rate_hertz=SAMPLE_RATE_HERTZ,
            language_code=lang_code,
            enable_automatic_punctuation=True,
            interim_results=True, # Key for low latency
        )

    async def _stt_request_generator(self):
        """
        A generator that yields audio chunks from the WebSocket.
        The first request to the API must be the config.
        """
        try:
            # Send configuration first
            yield speech.StreamingRecognizeRequest(config=self._stt_config)
            
            # Then, stream audio chunks from the client
            async for audio_chunk in self._websocket:
                yield speech.StreamingRecognizeRequest(audio_content=audio_chunk)
        except websockets.exceptions.ConnectionClosed:
            print("Client connection closed.")
        except Exception as e:
            print(f"Error in STT request generator: {e}")
        

    async def _process_stt_responses(self):
        """
        Processes responses from the STT API and puts final transcripts
        into the translation queue.
        """
        try:
            # The responses are a stream of StreamingRecognitionResult objects.
            self._stt_stream = self._speech_client.streaming_recognize(
                requests=self._stt_request_generator()
            )

            async for response in self._stt_stream:
                if not response.results:
                    continue

                result = response.results[0]
                if not result.alternatives:
                    continue
                
                transcript = result.alternatives[0].transcript

                # For this PoC, we translate only final results for accuracy.
                # For ultra-low latency, you could translate interim results
                # with a small delay, but this can lead to re-translations.
                if result.is_final:
                    print(f"Final transcript: {transcript}")
                    await self._translation_queue.put(transcript)
                else:
                    print(f"Interim transcript: {transcript}")
                    # You could optionally send interim transcripts to the client UI here
        except Exception as e:
            print(f"Error processing STT responses: {e}")
        finally:
            await self._translation_queue.put(None) # Signal that STT is done

    async def _translate_and_synthesize(self):
        """

        Continuously gets transcripts from the queue, translates them,
        synthesizes audio, and sends it back to the client.
        """
        while True:
            try:
                transcript = await self._translation_queue.get()
                if transcript is None:
                    # End of stream
                    break

                if not transcript:
                    continue

                # --- 2. Machine Translation ---
                translation_response = self._translate_client.translate(
                    transcript, target_language=self._target_lang_code
                )
                translated_text = translation_response["translatedText"]
                print(f"Translated text: {translated_text}")

                # --- 3. Text-to-Speech ---
                synthesis_input = texttospeech.SynthesisInput(text=translated_text)
                voice = texttospeech.VoiceSelectionParams(
                    language_code=self._target_lang, name=f"{self._target_lang}-Standard-A"
                )
                audio_config = texttospeech.AudioConfig(
                    audio_encoding=texttospeech.AudioEncoding.MP3
                )

                tts_response = self._tts_client.synthesize_speech(
                    input=synthesis_input, voice=voice, audio_config=audio_config
                )

                # Send the synthesized MP3 audio back over the WebSocket
                await self._websocket.send(tts_response.audio_content)
                
            except Exception as e:
                print(f"Error in translation/synthesis loop: {e}")
                break

    async def start(self):
        """Starts the concurrent STT and TTS processes for the connection."""
        print(f"Starting translation from {self._source_lang} to {self._target_lang}")
        
        stt_task = asyncio.create_task(self._process_stt_responses())
        tts_task = asyncio.create_task(self._translate_and_synthesize())
        
        # Wait for both tasks to complete.
        await asyncio.gather(stt_task, tts_task)
