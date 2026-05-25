# ChronicleOS — Complete AI Agent Build Guide

## Project Overview

ChronicleOS is a personal semantic memory engine that captures and organizes your browsing history. It consists of a Chrome extension, a Python backend, and a React dashboard, allowing users to retrieve and interact with their browsing data through natural language queries.

## Features

- **Chrome Extension**: Captures browsing sessions and selected text.
- **Python Backend**: Handles data storage, embedding, and search functionalities.
- **React Dashboard**: Provides a user-friendly interface to visualize and query browsing history.

## Getting Started

### Prerequisites

1. **Node.js**: Ensure you have Node.js version 18 or higher installed.
2. **Python**: Make sure Python 3.8 or higher is installed.
3. **API Keys**: Obtain API keys for Groq and Nomic AI as outlined in the setup instructions.

### Setup Instructions

1. **Clone the Repository**:
   ```
   git clone <repository-url>
   cd chronicleos
   ```

2. **Create Environment Variables**:
   Create a `.env` file in the `backend` directory and add your API keys:
   ```
   GROQ_API_KEY=your_groq_api_key
   NOMIC_API_KEY=your_nomic_api_key
   ```

3. **Install Backend Dependencies**:
   Navigate to the `backend` directory and install the required Python packages:
   ```
   cd backend
   python -m venv venv
   source venv/bin/activate  # On Windows use: venv\Scripts\activate
   pip install -r requirements.txt
   ```

4. **Install Frontend Dependencies**:
   Navigate to the `dashboard` directory and install the required Node.js packages:
   ```
   cd ../dashboard
   npm install
   ```

5. **Build and Run the Chrome Extension**:
   Navigate to the `extension` directory and run the development server:
   ```
   cd ../extension
   npm install
   npm run dev
   ```

6. **Run the Backend**:
   Start the FastAPI backend:
   ```
   cd ../backend
   python main.py
   ```

7. **Start the React Dashboard**:
   In a new terminal, navigate to the `dashboard` directory and start the development server:
   ```
   cd ../dashboard
   npm run dev
   ```

### Usage

- **Chrome Extension**: After loading the extension in Chrome, it will start capturing your browsing sessions.
- **Dashboard**: Access the dashboard at `http://localhost:5173` to view your captured sessions, search your history, and ask questions about your browsing data.

## Troubleshooting

- Ensure all services are running and accessible.
- Check the console for any errors in the Chrome extension or the dashboard.
- Verify that the API keys in the `.env` file are correct.

## License

This project is licensed under the MIT License. See the LICENSE file for more details.