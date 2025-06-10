document.addEventListener('DOMContentLoaded', () => {
    const authView = document.getElementById('auth-view');
    const callView = document.getElementById('call-view');
    const authFormContainer = document.getElementById('auth-form-container');
    const startCallBtn = document.getElementById('start-call-btn');
    const endCallBtn = document.getElementById('end-call-btn');
    const callStatus = document.getElementById('call-status');

    // --- Config ---
    const API_URL = 'http://localhost:8000'; // Our local backend
    let pc = null; // Peer Connection
    let ws = null; // WebSocket

    // --- Core Functions ---

    function updateView() {
        if (localStorage.getItem('accessToken')) {
            authView.classList.add('hidden');
            callView.classList.remove('hidden');
        } else {
            authView.classList.remove('hidden');
            callView.classList.add('hidden');
            renderLoginForm();
        }
    }

    async function handleAuth(endpoint, payload) {
        try {
            const response = await fetch(`${API_URL}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail);
            }

            if (endpoint === '/login') {
                const data = await response.json();
                localStorage.setItem('accessToken', data.access_token);
                updateView();
            } else if (endpoint === '/signup') {
                alert('Signup successful! Please log in.');
                renderLoginForm();
            }
        } catch (error) {
            alert(`Error: ${error.message}`);
        }
    }

    // --- WebRTC Call Logic ---

    async function startCall() {
        callStatus.textContent = 'Connecting...';
        startCallBtn.classList.add('hidden');
        endCallBtn.classList.remove('hidden');
        
        ws = new WebSocket('ws://localhost:8000/call');
        pc = new RTCPeerConnection();

        pc.onicecandidate = event => {
            // In a real app, send these candidates to the other peer via WebSocket
            // For this setup, we handle negotiation upfront.
        };

        pc.ontrack = event => {
            // We received the translated audio back from the server
            const audio = document.createElement('audio');
            audio.srcObject = event.streams[0];
            audio.autoplay = true;
            document.body.appendChild(audio);
            callStatus.textContent = 'Connected & Translating';
        };

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        stream.getTracks().forEach(track => pc.addTrack(track, stream));

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        ws.onopen = () => {
            ws.send(JSON.stringify({ sdp: pc.localDescription.sdp, type: pc.localDescription.type }));
        };

        ws.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            if (data.sdp) {
                await pc.setRemoteDescription(new RTCSessionDescription(data));
            }
        };
    }

    function endCall() {
        if (pc) pc.close();
        if (ws) ws.close();
        pc = null;
        ws = null;
        callStatus.textContent = 'Idle';
        startCallBtn.classList.remove('hidden');
        endCallBtn.classList.add('hidden');
        // Remove audio elements
        document.querySelectorAll('audio').forEach(el => el.remove());
    }

    // --- UI Rendering ---

    function renderLoginForm() {
        authFormContainer.innerHTML = `
            <form id="login-form">
                <h3>Login</h3>
                <input type="email" name="email" placeholder="Email" required>
                <input type="password" name="password" placeholder="Password" required>
                <button type="submit">Login</button>
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
            <form id="signup-form">
                <h3>Create Account</h3>
                <input type="email" name="email" placeholder="Email" required>
                <input type="password" name="password" placeholder="Password" required>
                <button type="submit">Sign Up</button>
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

    // --- Initializer ---
    startCallBtn.addEventListener('click', startCall);
    endCallBtn.addEventListener('click', endCall);
    updateView();
});
