document.addEventListener('DOMContentLoaded', () => {
    const heroSection = document.getElementById('hero');
    const authSection = document.getElementById('auth-section'); // The container for auth/call views
    const authView = document.getElementById('auth-view');
    const callView = document.getElementById('call-view');
    const authFormContainer = document.getElementById('auth-form-container');
    const startCallBtn = document.getElementById('start-call-btn');
    const endCallBtn = document.getElementById('end-call-btn');
    const callStatus = document.getElementById('call-status');
    const sourceTextDisplay = document.getElementById('source-text');
    const targetTextDisplay = document.getElementById('target-text');

    const mobileMenuButton = document.getElementById('mobile-menu-button');
    const mobileMenu = document.getElementById('mobile-menu');

    // --- Config ---
    const API_URL = 'http://localhost:8000'; // Our local backend API base URL
    let pc = null; // Peer Connection for WebRTC
    let ws = null; // WebSocket for signaling and initial audio streaming
    let currentStream = null; // To hold the local media stream

    // --- Utility Functions ---
    function showSpinner(buttonElement) {
        buttonElement.innerHTML = `
            <svg class="animate-spin h-5 w-5 text-white inline-block mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Processing...
        `;
        buttonElement.disabled = true;
    }

    function hideSpinner(buttonElement, originalText) {
        buttonElement.innerHTML = originalText;
        buttonElement.disabled = false;
    }

    // --- Core Functions ---

    /**
     * Updates the view based on authentication status.
     * Shows either the auth forms or the call interface.
     */
    function updateView() {
        if (localStorage.getItem('accessToken')) {
            authView.classList.add('hidden');
            callView.classList.remove('hidden');
            // Optionally scroll to the translation section if logged in directly
            authSection.scrollIntoView({ behavior: 'smooth' });
        } else {
            authView.classList.remove('hidden');
            callView.classList.add('hidden');
            renderLoginForm(); // Ensure login form is visible if not authenticated
        }
    }

    /**
     * Handles user authentication (login or signup).
     * @param {string} endpoint - The API endpoint ('/login' or '/signup').
     * @param {object} payload - The user credentials (email, password).
     */
    async function handleAuth(endpoint, payload) {
        const button = event.submitter; // Get the button that triggered the submit
        const originalButtonText = button.innerHTML;
        showSpinner(button);

        try {
            const response = await fetch(`${API_URL}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail || 'Authentication failed');
            }

            if (endpoint === '/login') {
                const data = await response.json();
                localStorage.setItem('accessToken', data.access_token);
                updateView(); // Transition to the call view
            } else if (endpoint === '/signup') {
                alert('Signup successful! Please log in.');
                renderLoginForm(); // After signup, show login form
            }
        } catch (error) {
            alert(`Error: ${error.message}`);
        } finally {
            hideSpinner(button, originalButtonText);
        }
    }

    // --- WebRTC Call Logic ---

    async function startCall() {
        callStatus.textContent = 'Connecting...';
        callStatus.classList.remove('text-warning', 'text-error', 'text-success');
        callStatus.classList.add('text-yellow-500'); // Pending color

        startCallBtn.classList.add('hidden');
        endCallBtn.classList.remove('hidden');
        sourceTextDisplay.textContent = '';
        targetTextDisplay.textContent = '';


        try {
            // Establish WebSocket connection for signaling
            ws = new WebSocket(`ws://localhost:8000/call?token=${localStorage.getItem('accessToken')}`);

            ws.onopen = async () => {
                console.log('WebSocket connected.');
                // Initialize RTCPeerConnection
                pc = new RTCPeerConnection({
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        // Add more TURN servers for production if needed
                    ]
                });

                // Handle ICE candidates (network information)
                pc.onicecandidate = event => {
                    if (event.candidate) {
                        ws.send(JSON.stringify({ 'candidate': event.candidate }));
                    }
                };

                // Handle incoming translated audio stream
                pc.ontrack = event => {
                    console.log('Received remote track:', event.streams[0]);
                    const audio = new Audio();
                    audio.srcObject = event.streams[0];
                    audio.autoplay = true;
                    // Mute local audio to prevent echo if both sides hear original
                    // This assumes the backend handles the voice replacement entirely.
                    // If not, you might need to adjust local audio output.
                    // stream.getAudioTracks().forEach(track => track.enabled = false);

                    audio.onloadedmetadata = () => {
                        audio.play().catch(e => console.error("Error playing audio:", e));
                    };
                    document.body.appendChild(audio); // Append to body for quick testing, better to manage in a specific container
                    callStatus.textContent = 'Connected & Translating';
                    callStatus.classList.remove('text-yellow-500');
                    callStatus.classList.add('text-success');
                };

                // Get local audio stream
                currentStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                currentStream.getTracks().forEach(track => pc.addTrack(track, currentStream));

                // Create and set local offer
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                ws.send(JSON.stringify({ 'sdp': pc.localDescription }));
            };

            ws.onmessage = async (event) => {
                const data = JSON.parse(event.data);
                if (data.sdp) {
                    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
                    if (pc.remoteDescription.type === 'offer') {
                        const answer = await pc.createAnswer();
                        await pc.setLocalDescription(answer);
                        ws.send(JSON.stringify({ 'sdp': pc.localDescription }));
                    }
                } else if (data.candidate) {
                    try {
                        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                    } catch (e) {
                        console.error('Error adding received ICE candidate', e);
                    }
                } else if (data.source_text) {
                    sourceTextDisplay.textContent = data.source_text;
                } else if (data.target_text) {
                    targetTextDisplay.textContent = data.target_text;
                }
            };

            ws.onerror = (error) => {
                console.error('WebSocket Error:', error);
                callStatus.textContent = 'Connection Error';
                callStatus.classList.remove('text-yellow-500', 'text-success');
                callStatus.classList.add('text-error');
                endCall();
                alert('Connection error. Please try again.');
            };

            ws.onclose = () => {
                console.log('WebSocket closed.');
                if (callStatus.textContent !== 'Connection Error') { // Don't override error message
                     callStatus.textContent = 'Call Ended';
                     callStatus.classList.remove('text-yellow-500', 'text-success');
                     callStatus.classList.add('text-error');
                }
                endCall();
            };

        } catch (error) {
            console.error("Error starting call:", error);
            callStatus.textContent = 'Call Failed';
            callStatus.classList.remove('text-yellow-500', 'text-success');
            callStatus.classList.add('text-error');
            endCall();
            alert('Failed to start call. Ensure microphone access and backend is running.');
        }
    }

    function endCall() {
        if (pc) {
            pc.getSenders().forEach(sender => {
                if (sender.track) {
                    sender.track.stop(); // Stop microphone track
                }
            });
            pc.close();
            pc = null;
        }
        if (ws) {
            ws.close();
            ws = null;
        }
        if (currentStream) {
            currentStream.getTracks().forEach(track => track.stop()); // Stop all tracks from the stream
            currentStream = null;
        }
        callStatus.textContent = 'Idle';
        callStatus.classList.remove('text-success', 'text-error', 'text-yellow-500');
        callStatus.classList.add('text-warning'); // Back to warning (idle) color
        startCallBtn.classList.remove('hidden');
        endCallBtn.classList.add('hidden');
        // Remove dynamically added audio elements
        document.querySelectorAll('audio').forEach(el => el.remove());
    }

    // --- UI Rendering ---

    function renderLoginForm() {
        authFormContainer.innerHTML = `
            <form id="login-form" class="space-y-6">
                <h3 class="text-2xl font-bold mb-4">Login to your account</h3>
                <div>
                    <input type="email" name="email" placeholder="Email" required class="w-full">
                </div>
                <div>
                    <input type="password" name="password" placeholder="Password" required class="w-full">
                </div>
                <button type="submit" class="w-full">Login</button>
            </form>
            <a class="toggle-form" id="show-signup">Don't have an account? Sign Up</a>
        `;
        document.getElementById('login-form').addEventListener('submit', e => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const payload = Object.fromEntries(formData.entries());
            handleAuth('/login', payload);
        });
        document.getElementById('show-signup').addEventListener('click', renderSignupForm);
    }

    function renderSignupForm() {
        authFormContainer.innerHTML = `
            <form id="signup-form" class="space-y-6">
                <h3 class="text-2xl font-bold mb-4">Create a new account</h3>
                <div>
                    <input type="email" name="email" placeholder="Email" required class="w-full">
                </div>
                <div>
                    <input type="password" name="password" placeholder="Password" required class="w-full">
                </div>
                <button type="submit" class="w-full">Sign Up</button>
            </form>
            <a class="toggle-form" id="show-login">Already have an account? Login</a>
        `;
        document.getElementById('signup-form').addEventListener('submit', e => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const payload = Object.fromEntries(formData.entries());
            handleAuth('/signup', payload);
        });
        document.getElementById('show-login').addEventListener('click', renderLoginForm);
    }

    // --- Event Listeners & Initializer ---

    // Mobile menu toggle
    mobileMenuButton.addEventListener('click', () => {
        mobileMenu.classList.toggle('hidden');
    });

    // Close mobile menu when a link is clicked
    mobileMenu.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            mobileMenu.classList.add('hidden');
        });
    });

    // Anchor link smooth scrolling
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            document.querySelector(this.getAttribute('href')).scrollIntoView({
                behavior: 'smooth'
            });
        });
    });

    startCallBtn.addEventListener('click', startCall);
    endCallBtn.addEventListener('click', endCall);

    // Initial view update on page load
    updateView();
});
