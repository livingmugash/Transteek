# backend/main.py

import asyncio
import websockets
import os
from dotenv import load_dotenv
from translator_agent import RealTimeTranslator

# Load environment variables from .env file for local development
load_dotenv()

async def connection_handler(websocket, path):
    """
    Main WebSocket handler. It creates a RealTimeTranslator instance for each
    new connection and starts the translation process.
    """
    print("Client connected.")
    try:
        # The first message from the client is the configuration string
        config_message = await websocket.recv()
        source_lang, target_lang = config_message.split(',')
        
        # Create a translator agent for this specific connection
        translator = RealTimeTranslator(websocket, source_lang, target_lang)
        await translator.start()

    except websockets.exceptions.ConnectionClosed as e:
        print(f"Connection closed gracefully: {e. B}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
    finally:
        print("Client disconnected.")

async def main():
    """Starts the WebSocket server."""
    # Ensure the GOOGLE_APPLICATION_CREDENTIALS environment variable is set
    if "GOOGLE_APPLICATION_CREDENTIALS" not in os.environ:
        raise EnvironmentError(
            "GOOGLE_APPLICATION_CREDENTIALS not set. "
            "Please check your .env file or server configuration."
        )

    host = "0.0.0.0"  # Listen on all available network interfaces
    port = int(os.environ.get("PORT", 8765)) # Use PORT from env, default to 8765

    print(f"Starting Transteek WebSocket server on ws://{host}:{port}")
    async with websockets.serve(connection_handler, host, port):
        await asyncio.Future()  # Run forever

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Server shutting down.")
