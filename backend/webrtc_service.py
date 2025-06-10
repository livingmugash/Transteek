from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc.contrib.media import MediaRelay, MediaStreamTrack
import asyncio

# A simple track that receives audio from the translator and sends it to the browser.
class AudioSpoolTrack(MediaStreamTrack):
    kind = "audio"

    def __init__(self):
        super().__init__()
        self.queue = asyncio.Queue()

    async def recv(self):
        frame = await self.queue.get()
        return frame

# This class will manage the connection and translation for a single call
class CallSession:
    def __init__(self):
        self.pc = RTCPeerConnection()
        self.relay = MediaRelay()
        self.web_track = None
        self.spool_track = AudioSpoolTrack()

        @self.pc.on("track")
        async def on_track(track):
            print(f"Track {track.kind} received")
            if track.kind == "audio":
                self.web_track = track
                # Here is where the magic happens:
                # We relay the incoming audio from the browser to our translator
                asyncio.create_task(self.start_translation_pipeline(self.web_track))
            
            @track.on("ended")
            async def on_ended():
                print(f"Track {track.kind} ended")

    async def start_translation_pipeline(self, track):
        # This is the core loop
        # TODO: Connect this to the actual translator_agent
        print("Translation Pipeline Started.")
        while True:
            try:
                frame = await track.recv()
                # 1. SEND frame.to_ndarray() to Google STT
                # 2. GET translated audio back from TTS
                # 3. CONVERT translated audio back to a frame
                # 4. PUT the translated frame into the spool track
                # await self.spool_track.queue.put(translated_frame)

                # For now, we'll just echo the audio back (parrot mode)
                await self.spool_track.queue.put(frame)
            except Exception as e:
                print(f"Error in pipeline: {e}")
                break
        print("Translation Pipeline Ended.")

    async def handle_offer(self, sdp, type):
        offer = RTCSessionDescription(sdp=sdp, type=type)
        await self.pc.setRemoteDescription(offer)
        
        # Add the track that will send translated audio TO the browser
        self.pc.addTrack(self.spool_track)

        answer = await self.pc.createAnswer()
        await self.pc.setLocalDescription(answer)
        
        return {"sdp": self.pc.localDescription.sdp, "type": self.pc.localDescription.type}

    async def close(self):
        await self.pc.close()
