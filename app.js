document.addEventListener('DOMContentLoaded', () => {
    // --- Mock User Authentication ---
    // In a real app, this would involve tokens (JWT)
    let isLoggedIn = false;

    const loginSection = document.getElementById('login');
    const translatorSection = document.getElementById('translator');

    // For now, we'll just simulate a login
    // In a real app, you would have a form here that sends a request to your backend
    const loginButton = document.querySelector('.button-primary');
    loginButton.addEventListener('click', (e) => {
        e.preventDefault();
        isLoggedIn = true;
        loginSection.classList.add('hidden');
        translatorSection.classList.remove('hidden');
        initializeTranslator();
    });
    
    // --- WebSocket and Audio Logic ---
    let websocket;
    let audioContext;
    let processor;
    let microphone;
    let isTranscribing = false;

    const micButton = document.getElementById('mic-button');
    const statusMessage = document.getElementById('status-message');

    function initializeTranslator() {
        micButton.addEventListener('click', toggleTranscription);
    }

    async function toggleTranscription() {
        if (isTranscribing) {
            // Stop transcription
            isTranscribing = false;
            micButton.textContent = 'Start Speaking';
            micButton.classList.remove('is-active');
            statusMessage.textContent = "Disconnected";

            if (microphone) microphone.disconnect();
            if (processor) processor.disconnect();
            if (audioContext) audioContext.close();
            if (websocket) websocket.close();
            
        } else {
            // Start transcription
            isTranscribing = true;
            micButton.textContent = 'Stop';
            micButton.classList.add('is-active');
            statusMessage.textContent = "Connecting...";
            await startStreaming();
        }
    }

    async function startStreaming() {
        // Replace with your deployed backend's WebSocket URL
        const WEBSOCKET_URL = "ws://localhost:8765"; 
        websocket = new WebSocket(WEBSOCKET_URL);

        websocket.onopen = () => {
            statusMessage.textContent = "Connected. Start speaking.";
            // Config message: speak Spanish, receive English translation
            websocket.send("es-ES,en-US"); 
            startMicrophone();
        };

        websocket.onmessage = (event) => {
            if (event.data instanceof Blob) {
                // We are receiving audio data
                const audioUrl = URL.createObjectURL(event.data);
                const audio = new Audio(audioUrl);
                audio.play();
            } else {
                // We are receiving text data (if you implement text streaming)
                // For this example, we'll assume only audio comes back
                console.log("Received text data:", event.data);
            }
        };

        websocket.onclose = () => {
            statusMessage.textContent = "Connection closed.";
            isTranscribing = false;
        };

        websocket.onerror = (error) => {
            console.error("WebSocket Error:", error);
            statusMessage.textContent = "Error connecting.";
            isTranscribing = false;
        };
    }

    function startMicrophone() {
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        
        navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
            microphone = audioContext.createMediaStreamSource(stream);
            processor = audioContext.createScriptProcessor(4096, 1, 1);

            processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                const downsampledData = convertTo16BitPCM(inputData);
                
                if (websocket.readyState === WebSocket.OPEN) {
                    websocket.send(downsampledData);
                }
            };

            microphone.connect(processor);
            processor.connect(audioContext.destination);
        }).catch(error => {
            console.error("Microphone access denied:", error);
            statusMessage.textContent = "Microphone access denied.";
        });
    }

    function convertTo16BitPCM(buffer) {
        const newBuffer = new Int16Array(buffer.length);
        for (let i = 0; i < buffer.length; i++) {
            const val = Math.max(-1, Math.min(1, buffer[i]));
            newBuffer[i] = val < 0 ? val * 0x8000 : val * 0x7FFF;
        }
        return newBuffer.buffer;
    }
});
