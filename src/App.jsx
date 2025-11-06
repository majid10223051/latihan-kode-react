import React, { useState } from 'react';

// --- Helper: SVG Loading Spinner ---
// A simple SVG spinner component to show while loading
const LoadingSpinner = () => (
  <svg
    className="animate-spin -ml-1 mr-3 h-8 w-8 text-purple-600"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    ></circle>
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    ></path>
  </svg>
);

// --- Main Application Component ---
export default function App() {
  // --- State Variables ---
  // Stores the user's text question
  const [prompt, setPrompt] = useState('');
  // Stores the selected image file for preview
  const [imageFile, setImageFile] = useState(null);
  // Stores the base64-encoded image data for the API
  const [imageBase64, setImageBase64] = useState(null);
  // Stores the MIME type of the image (e.g., "image/png")
  const [mimeType, setMimeType] = useState(null);
  // Stores the text response from the AI
  const [analysisResult, setAnalysisResult] = useState('');
  // Tracks if the API call is in progress
  const [isLoading, setIsLoading] = useState(false);
  // Stores any error messages
  const [error, setError] = useState(null);

  // --- API Configuration ---
  // Per instructions, leave apiKey empty. It will be provided by the environment.
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

  /**
   * Handles the file input change event.
   * Reads the selected file, creates a preview, and converts it to base64.
   */
  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      // 1. Reset state for new image
      setImageFile(null);
      setImageBase64(null);
      setMimeType(null);
      setAnalysisResult('');
      setError(null);

      // 2. Create a local URL for image preview
      setImageFile(file);

      // 3. Use FileReader to convert image to base64
      const reader = new FileReader();
      reader.onloadend = () => {
        // The result is a data URL: "data:image/png;base64,..."
        const dataUrl = reader.result;
        try {
          // Split the data URL to get the mime type and the base64 data
          const parts = dataUrl.split(',');
          if (parts.length !== 2) {
            throw new Error('Invalid data URL format');
          }

          const mimeMatch = parts[0].match(/:(.*?);/);
          if (!mimeMatch || mimeMatch.length < 2) {
            throw new Error('Could not parse MIME type');
          }

          const mime = mimeMatch[1];
          const base64Data = parts[1];

          // 4. Store the mime type and pure base64 data
          setMimeType(mime);
          setImageBase64(base64Data);
        } catch (err) {
          console.error('Error parsing data URL:', err);
          setError(
            'Error reading image file. Please try a different image.'
          );
        }
      };
      reader.onerror = () => {
        console.error('FileReader error');
        setError('Error reading file.');
      };
      reader.readAsDataURL(file);
    }
  };

  /**
   * Implements exponential backoff for API retries.
   * This is crucial for handling potential rate limits or transient network errors.
   */
  const fetchWithRetry = async (url, options, retries = 3, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, options);
        if (response.ok) {
          return response.json();
        }
        // Do not retry on client-side errors (4xx)
        if (response.status >= 400 && response.status < 500) {
          throw new Error(`Client error: ${response.status}`);
        }
        // Retry on server-side errors (5xx) or rate limits (429)
        if (i === retries - 1) {
          throw new Error(`Server error after ${retries} attempts`);
        }
      } catch (err) {
        if (i === retries - 1) throw err; // Re-throw last error
      }
      // Wait with exponential backoff
      await new Promise((resolve) => setTimeout(resolve, delay * Math.pow(2, i)));
    }
  };

  /**
   * Handles the form submission to the Gemini API.
   * Can accept a prompt override for "Quick Actions".
   */
  const handleSubmit = async (actionPrompt = null) => {
    // Use the actionPrompt if provided, otherwise use the prompt from state
    const promptToUse = actionPrompt || prompt;

    // 1. Validate input
    if (!imageBase64 || !promptToUse || !mimeType) {
      setError('Please upload an image and ask a question.');
      return;
    }

    // 2. Set loading state and clear old results
    setIsLoading(true);
    setError(null);
    setAnalysisResult('');

    // 3. Construct the API payload
    const payload = {
      contents: [
        {
          role: 'user',
          parts: [
            // First part: the text prompt
            { text: promptToUse },
            // Second part: the image data
            {
              inlineData: {
                mimeType: mimeType,
                data: imageBase64,
              },
            },
          ],
        },
      ],
    };

    // 4. Make the API call with retry logic
    try {
      const result = await fetchWithRetry(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      // 5. Process the response
      const text =
        result?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (text) {
        setAnalysisResult(text);
      } else {
        console.warn('API response structure missing expected text:', result);
        setError('Could not parse AI response. Please try again.');
      }
    } catch (err) {
      console.error('API call failed:', err);
      setError(
        `Analysis failed: ${err.message}. Please check your connection and try again.`
      );
    } finally {
      // 6. Unset loading state
      setIsLoading(false);
    }
  };

  /**
   * Handles the "Quick Action" buttons.
   * Sets the prompt in the UI and calls handleSubmit immediately.
   */
  const handleQuickAction = async (newPrompt) => {
    if (!imageBase64) {
      setError('Please upload an image before using a quick action.');
      return;
    }
    // Set state so the user sees which prompt is being used
    setPrompt(newPrompt);
    // Pass the prompt directly to handleSubmit to avoid state update lag
    await handleSubmit(newPrompt);
  };

  // --- Render (JSX) ---
  return (
    <div className="flex justify-center items-start min-h-screen bg-purple-50 p-4 sm:p-8 font-inter">
      <div className="w-full max-w-5xl bg-white shadow-2xl rounded-xl overflow-hidden">
        {/* Header */}
        <header className="p-6 bg-gradient-to-r from-pink-500 via-purple-600 to-indigo-600 text-white">
          <h1 className="text-2xl sm:text-3xl font-bold text-center">
            AI-Powered Image Analysis Tool
          </h1>
          <p className="text-center text-purple-100 mt-1">
            Upload an image and ask Gemini AI anything about it.
          </p>
        </header>

        {/* Main Content Area */}
        <main className="p-6 md:p-8">
          <div className="flex flex-col lg:flex-row lg:space-x-8">
            {/* Left Column: Inputs */}
            <div className="lg:w-1/2 w-full flex flex-col space-y-6">
              {/* 1. Image Upload */}
              <div>
                <label
                  htmlFor="file-upload"
                  className="block text-lg font-semibold mb-2 text-gray-900"
                >
                  1. Upload Your Image
                </label>
                <label
                  htmlFor="file-upload"
                  className="w-full flex justify-center px-4 py-6 bg-purple-50 border-2 border-purple-300 border-dashed rounded-lg cursor-pointer hover:bg-purple-100 transition-colors"
                >
                  <div className="text-center">
                    <svg
                      className="mx-auto h-12 w-12 text-purple-400"
                      stroke="currentColor"
                      fill="none"
                      viewBox="0 0 48 48"
                      aria-hidden="true"
                    >
                      <path
                        d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="mt-2 block text-sm font-medium text-purple-700">
                      {imageFile ? imageFile.name : 'Click to upload a file'}
                    </span>
                    <span className="block text-xs text-purple-500">
                      PNG, JPG, GIF up to 10MB
                    </span>
                  </div>
                </label>
                <input
                  id="file-upload"
                  name="file-upload"
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={handleImageChange}
                />
              </div>

              {/* Image Preview */}
              {imageFile && (
                <div className="mt-4">
                  <img
                    src={URL.createObjectURL(imageFile)}
                    alt="Image preview"
                    className="w-full h-auto max-h-64 object-contain rounded-lg border border-gray-200 shadow-sm"
                    onLoad={() => URL.revokeObjectURL(imageFile)} // Clean up object URL
                  />
                </div>
              )}

              {/* 2. Text Prompt */}
              <div>
                <label
                  htmlFor="prompt"
                  className="block text-lg font-semibold mb-2 text-gray-900"
                >
                  2. Ask a Question
                </label>
                <textarea
                  id="prompt"
                  rows="4"
                  className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-purple-500 focus:outline-none transition-shadow"
                  placeholder="e.g., What is in this image? How many dogs are there? What is the mood of this scene?"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </div>

              {/* ✨ AI-Powered Quick Actions */}
              <div className="pt-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Or try a Quick Action:
                </label>
                <div className="space-y-2 sm:space-y-0 sm:flex sm:space-x-2">
                  <button
                    onClick={() =>
                      handleQuickAction(
                        'Generate a creative and engaging caption for this image.'
                      )
                    }
                    disabled={!imageBase64 || isLoading}
                    className="w-full sm:w-auto flex-1 px-4 py-2 text-sm font-medium rounded-lg shadow-sm text-purple-800 bg-purple-100 hover:bg-purple-200 disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed transition-all"
                  >
                    ✨ Generate Caption
                  </button>
                  <button
                    onClick={() =>
                      handleQuickAction(
                        'Extract any and all text you can read from this image. If no text is present, say "No text found".'
                      )
                    }
                    disabled={!imageBase64 || isLoading}
                    className="w-full sm:w-auto flex-1 px-4 py-2 text-sm font-medium rounded-lg shadow-sm text-purple-800 bg-purple-100 hover:bg-purple-200 disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed transition-all"
                  >
                    ✨ Extract Text
                  </button>
                  <button
                    onClick={() =>
                      handleQuickAction(
                        'List the primary objects or subjects you see in this image.'
                      )
                    }
                    disabled={!imageBase64 || isLoading}
                    className="w-full sm:w-auto flex-1 px-4 py-2 text-sm font-medium rounded-lg shadow-sm text-purple-800 bg-purple-100 hover:bg-purple-200 disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed transition-all"
                  >
                    ✨ Identify Objects
                  </button>
                </div>
              </div>

              {/* 3. Submit Button */}
              <button
                onClick={() => handleSubmit()}
                disabled={isLoading || !imageBase64 || !prompt}
                className="w-full flex justify-center items-center px-6 py-3 border border-transparent text-base font-medium rounded-lg shadow-sm text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:bg-gray-400 disabled:cursor-not-allowed transition-all"
              >
                {isLoading ? (
                  <>
                    <LoadingSpinner />
                    Analyzing...
                  </>
                ) : (
                  'Analyze Image'
                )}
              </button>
            </div>

            {/* Right Column: Output */}
            <div className="lg:w-1/2 w-full mt-8 lg:mt-0">
              <label className="block text-lg font-semibold mb-2 text-gray-900">
                Analysis Result
              </label>
              <div className="w-full h-full min-h-[300px] sm:min-h-[400px] bg-gray-900 text-gray-100 rounded-lg border border-purple-500 shadow-inner p-6">
                {/* Error Message */}
                {error && (
                  <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
                    <p className="font-bold">Error</p>
                    <p>{error}</p>
                  </div>
                )}

                {/* Loading State */}
                {isLoading && (
                  <div className="flex flex-col justify-center items-center h-full">
                    <LoadingSpinner />
                    <p className="mt-4 text-gray-400">
                      AI is analyzing the image...
                    </p>
                  </div>
                )}

                {/* Analysis Result */}
                {!isLoading && !error && analysisResult && (
                  <p className="whitespace-pre-wrap font-mono text-sm leading-relaxed break-words">
                    {analysisResult}
                  </p>
                )}

                {/* Initial State */}
                {!isLoading && !error && !analysisResult && (
                  <p className="text-gray-500 text-center pt-20">
                    Your analysis results will appear here once you submit an
                    image and a prompt.
                  </p>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}