from fastapi import FastAPI, WebSocket, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import auth
import models
from webrtc_service import CallSession
import json

load_dotenv()

app = FastAPI()

# CORS Middleware to allow Vercel frontend to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, change to your Vercel URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/signup", response_model=models.UserLogin)
def signup(user: models.UserCreate):
    new_user = auth.create_user(user.email, user.password)
    if not new_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered or database error."
        )
    return {"email": new_user['email']}

@app.post("/login", response_model=models.Token)
def login(form_data: models.UserLogin):
    user = auth.authenticate_user(form_data.email, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = auth.create_access_token(data={"sub": user["email"]})
    return {"access_token": access_token, "token_type": "bearer"}

# WebSocket endpoint for the call
@app.websocket("/call")
async def call_endpoint(websocket: WebSocket):
    await websocket.accept()
    session = CallSession()
    
    try:
        # The first message from the client is the WebRTC offer
        message = await websocket.receive_text()
        data = json.loads(message)

        if data['type'] == 'offer':
            response = await session.handle_offer(data['sdp'], data['type'])
            await websocket.send_json(response)
        
        # Keep the connection alive to handle ICE candidates, etc.
        # A production app would have more robust signaling here.
        while True:
            await websocket.receive_text() # Keep alive

    except Exception as e:
        print(f"Error in call endpoint: {e}")
    finally:
        print("Closing call session.")
        await session.close()
