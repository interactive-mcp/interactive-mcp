// VS Code Webview Popup JavaScript
(function() {
    'use strict';

    // State management
    let timeoutInterval = null;
    let remainingTime = 0;
    let isDisposed = false;
    let countdownPaused = false;

    // Initialize popup
    function initializePopup() {
        // Send debug message to extension
        try {
            vscode.postMessage({
                type: 'debug',
                message: 'Popup JavaScript initialized',
                config: popupConfig
            });
        } catch (e) {
            // vscode object might not be available yet
        }

        // Ensure custom text elements are hidden initially
        const customTextInput = document.getElementById('customTextInput');
        const customActionButtons = document.getElementById('customActionButtons');
        if (customTextInput) {
            customTextInput.style.display = 'none';
        }
        if (customActionButtons) {
            customActionButtons.style.display = 'none';
        }

        // Set up event listeners
        setupEventListeners();

        // Start timeout countdown if applicable
        if (popupConfig.timeout && popupConfig.timeout > 0) {
            startTimeoutCountdown();
        }

        // Focus first button or close button
        focusFirstInteractiveElement();

        // Send ready message to extension
        try {
            vscode.postMessage({
                type: 'debug',
                message: 'Popup fully initialized and ready'
            });
        } catch (e) {
            // Ignore errors
        }
    }

    function setupEventListeners() {
        // Close button
        const closeButton = document.getElementById('closeButton');
        if (closeButton) {
            closeButton.addEventListener('click', handleClose);
        }

        const buttons = document.querySelectorAll('.popup-actions .popup-button:not(#customTextButton)');
        try {
            vscode.postMessage({
                type: 'debug',
                message: `Found ${buttons.length} popup buttons (excluding custom text button)`,
                buttonIds: Array.from(buttons).map(b => b.dataset.buttonId)
            });
        } catch (e) {
            // Ignore errors
        }

        buttons.forEach((button, index) => {
            button.addEventListener('click', handleButtonClick);
        });

        // Custom text functionality
        const customTextButton = document.getElementById('customTextButton');
        const customTextArea = document.getElementById('customTextArea');
        const customTextInput = document.getElementById('customTextInput');
        const sendCustomTextButton = document.getElementById('sendCustomTextButton');
        const cancelCustomTextButton = document.getElementById('cancelCustomTextButton');

        if (customTextButton) {
            customTextButton.addEventListener('click', handleCustomTextToggle);
        }
        if (sendCustomTextButton) {
            sendCustomTextButton.addEventListener('click', handleSendCustomText);
        }
        if (cancelCustomTextButton) {
            cancelCustomTextButton.addEventListener('click', handleCancelCustomText);
        }
        if (customTextInput) {
            customTextInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && e.ctrlKey) {
                    e.preventDefault();
                    handleSendCustomText();
                }
            });
        }

        // Input type specific handlers
        if (popupConfig.type === 'input') {
            const sendInputButton = document.getElementById('sendInputButton');
            const inputTextArea = document.getElementById('inputTextArea');
            if (sendInputButton) {
                sendInputButton.addEventListener('click', handleSendInput);
            }
            const cancelInputButton = document.getElementById('cancelInputButton');
            if (cancelInputButton) {
                cancelInputButton.addEventListener('click', handleClose);
            }
            if (inputTextArea) {
                inputTextArea.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && e.ctrlKey) {
                        e.preventDefault();
                        handleSendInput();
                    }
                });
            }
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', handleKeyDown);

        // Prevent context menu (optional)
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        // Handle window beforeunload
        window.addEventListener('beforeunload', handleBeforeUnload);
    }

    function handleButtonClick(event) {
        if (isDisposed) return;

        const button = event.currentTarget;
        const buttonId = button.dataset.buttonId;
        const action = button.dataset.action;

        // Handle custom text button specially
        if (action === 'custom-text') {
            handleCustomTextToggle();
            return;
        }

        // Send debug message about button click
        try {
            vscode.postMessage({
                type: 'debug',
                message: `Button clicked: ${buttonId}`,
                buttonId: buttonId,
                action: action
            });
        } catch (e) {
            // Ignore errors
        }

        // Add loading state
        button.classList.add('loading');
        button.disabled = true;

        // Prepare response data
        const responseData = {
            type: 'button_click',
            buttonId: buttonId,
            action: action,
            timestamp: Date.now(),
            data: gatherFormData()
        };

        // Send debug message before sending actual response
        try {
            vscode.postMessage({
                type: 'debug',
                message: `About to send button response: ${buttonId}`,
                responseData: responseData
            });
        } catch (e) {
            // Ignore errors
        }

        // Send response to extension
        sendMessage(responseData);

        // Prevent multiple clicks
        setTimeout(() => {
            if (!isDisposed) {
                button.classList.remove('loading');
                button.disabled = false;
            }
        }, 1000);
    }

    function handleCustomTextToggle() {
        // Debug logging at start
        try {
            vscode.postMessage({
                type: 'debug',
                message: 'handleCustomTextToggle called'
            });
        } catch (e) {
            console.log('handleCustomTextToggle called');
        }

        const customTextInput = document.getElementById('customTextInput');
        const customActionButtons = document.getElementById('customActionButtons');

        // Debug element existence
        try {
            vscode.postMessage({
                type: 'debug',
                message: `Elements found - customTextInput: ${!!customTextInput}, customActionButtons: ${!!customActionButtons}`
            });
        } catch (e) {
            console.log(`Elements found - customTextInput: ${!!customTextInput}, customActionButtons: ${!!customActionButtons}`);
        }

        if (customTextInput && customActionButtons) {
            // Check if textarea is currently visible
            const computedStyle = window.getComputedStyle(customTextInput);
            const isVisible = computedStyle.display !== 'none' && customTextInput.style.display !== 'none';

            // Debug logging
            try {
                vscode.postMessage({
                    type: 'debug',
                    message: `Toggle clicked - isVisible: ${isVisible}, computedStyle.display: ${computedStyle.display}, inline style: '${customTextInput.style.display}'`
                });
            } catch (e) {
                console.log(`Toggle clicked - isVisible: ${isVisible}, computedStyle.display: ${computedStyle.display}, inline style: '${customTextInput.style.display}'`);
            }

            if (isVisible) {
                // Hide custom text input and action buttons (option buttons stay visible)
                customTextInput.style.display = 'none';
                customActionButtons.style.display = 'none';
                try {
                    vscode.postMessage({
                        type: 'debug',
                        message: 'Custom text input hidden, option buttons remain visible'
                    });
                } catch (e) {
                    console.log('Custom text input hidden, option buttons remain visible');
                }
            } else {
                // Show custom text input and action buttons (option buttons stay visible)
                customTextInput.style.display = 'block';
                customActionButtons.style.display = 'flex';
                try {
                    vscode.postMessage({
                        type: 'debug',
                        message: 'Custom text input shown, option buttons remain visible'
                    });
                } catch (e) {
                    console.log('Custom text input shown, option buttons remain visible');
                }
                // Small delay to ensure DOM is updated before focusing
                setTimeout(() => {
                    customTextInput.focus();
                }, 10);
            }
        } else {
            try {
                vscode.postMessage({
                    type: 'debug',
                    message: 'Required elements not found!'
                });
            } catch (e) {
                console.log('Required elements not found!');
            }
        }
    }

    function handleSendCustomText() {
        if (isDisposed) return;

        const customTextInput = document.getElementById('customTextInput');
        const customText = customTextInput ? customTextInput.value.trim() : '';

        if (!customText) {
            // Show a brief error indication
            if (customTextInput) {
                customTextInput.style.borderColor = '#ff4444';
                setTimeout(() => {
                    customTextInput.style.borderColor = '';
                }, 1000);
            }
            return;
        }

        const responseData = {
            command: 'textInput',
            text: customText,
            timestamp: Date.now(),
            data: gatherFormData()
        };

        try {
            vscode.postMessage({
                type: 'debug',
                message: 'Sending custom text response',
                customText: customText
            });
        } catch (e) {
            // Ignore
        }

        sendMessage(responseData);
    }

    function handleCancelCustomText() {
        handleCustomTextToggle(); // This will hide the custom text area and show regular buttons
    }

    function handleSendInput() {
        if (isDisposed) return;
        const inputTextArea = document.getElementById('inputTextArea');
        const text = inputTextArea ? inputTextArea.value.trim() : '';
        if (!text) return;
        const responseData = {
            command: 'textSubmitted',
            text: text,
            data: { inputValue: text },
            timestamp: Date.now()
        };
        sendMessage(responseData);
    }

    function handleClose() {
        if (isDisposed) return;

        console.log('Close button clicked');

        const responseData = {
            command: 'cancelled',
            timestamp: Date.now(),
            dismissed: true
        };

        sendMessage(responseData);
    }

    function handleKeyDown(event) {
        if (isDisposed) return;

        switch (event.key) {
            case 'Escape':
                event.preventDefault();
                handleClose();
                break;

            case 'Enter':
                // Allow multiline editing in textarea/input unless Ctrl+Enter is pressed
                if (document.activeElement && (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT')) {
                    if (event.ctrlKey) {
                        // Ctrl+Enter should submit via specific handlers; do nothing here.
                        return;
                    }
                    // Plain Enter inside textarea/input inserts newline – do not prevent.
                    return;
                }

                // If focus is on a button, trigger click
                if (document.activeElement && document.activeElement.classList.contains('popup-button')) {
                    event.preventDefault();
                    document.activeElement.click();
                } else {
                    // Find primary button and click it
                    const primaryButton = document.querySelector('.popup-button--primary');
                    if (primaryButton) {
                        event.preventDefault();
                        primaryButton.click();
                    }
                }
                break;

            case 'Tab':
                // Enhanced tab navigation
                handleTabNavigation(event);
                break;

            case 'ArrowLeft':
            case 'ArrowRight':
                // Navigate between buttons
                if (document.activeElement && document.activeElement.classList.contains('popup-button')) {
                    event.preventDefault();
                    navigateBetweenButtons(event.key === 'ArrowRight');
                }
                break;
        }
    }

    function handleTabNavigation(event) {
        const focusableElements = document.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );

        const focusableArray = Array.from(focusableElements);
        const currentIndex = focusableArray.indexOf(document.activeElement);

        if (event.shiftKey) {
            // Shift+Tab - go backwards
            const prevIndex = currentIndex <= 0 ? focusableArray.length - 1 : currentIndex - 1;
            focusableArray[prevIndex]?.focus();
        } else {
            // Tab - go forwards
            const nextIndex = currentIndex >= focusableArray.length - 1 ? 0 : currentIndex + 1;
            focusableArray[nextIndex]?.focus();
        }

        event.preventDefault();
    }

    function navigateBetweenButtons(forward) {
        const buttons = document.querySelectorAll('.popup-button');
        const buttonsArray = Array.from(buttons);
        const currentIndex = buttonsArray.indexOf(document.activeElement);

        if (currentIndex !== -1) {
            const newIndex = forward
                ? (currentIndex + 1) % buttonsArray.length
                : (currentIndex - 1 + buttonsArray.length) % buttonsArray.length;

            buttonsArray[newIndex]?.focus();
        }
    }

    function startTimeoutCountdown() {
        remainingTime = Math.ceil(popupConfig.timeout / 1000);
        const timeoutDisplay = document.getElementById('timeoutDisplay');
        const popupFooter = document.querySelector('.popup-footer');
        if (!timeoutDisplay) return;

        // Click entire footer to pause/resume
        if (popupFooter) {
            popupFooter.addEventListener('click', () => {
                if (!timeoutInterval) return; // nothing to pause if no interval
                if (countdownPaused) {
                    // resume
                    countdownPaused = false;
                    timeoutDisplay.classList.remove('paused');
                    timeoutDisplay.innerHTML = `Timeout: ${remainingTime}s`; // reset text
                } else {
                    // pause
                    countdownPaused = true;
                    timeoutDisplay.classList.add('paused');
                    timeoutDisplay.innerHTML = `<span class="pause-icon">⏸</span>Timeout: ${remainingTime}s`;
                }
            });
        }

        timeoutInterval = setInterval(() => {
            if (countdownPaused) return; // skip tick while paused

            remainingTime--;
            timeoutDisplay.textContent = `Timeout: ${remainingTime}s`;

            // Add warning class when less than 10 seconds remain
            if (remainingTime <= 10) {
                timeoutDisplay.classList.add('warning');
            }

            // Auto-close when timeout reaches 0
            if (remainingTime <= 0) {
                clearInterval(timeoutInterval);
                const responseData = {
                    command: 'cancelled',
                    timestamp: Date.now(),
                    dismissed: true
                };
                sendMessage(responseData);
            }
        }, 1000);
    }

    function focusFirstInteractiveElement() {
        // Try to focus the primary button first
        let elementToFocus = document.querySelector('.popup-button--primary');

        // If no primary button, focus the first button
        if (!elementToFocus) {
            elementToFocus = document.querySelector('.popup-button');
        }

        // If no buttons, focus the close button
        if (!elementToFocus) {
            elementToFocus = document.getElementById('closeButton');
        }

        if (elementToFocus) {
            elementToFocus.focus();
        }
    }

    function gatherFormData() {
        // Collect any form data from the popup
        const data = {};

        // Get all input elements
        const inputs = document.querySelectorAll('input, textarea, select');
        inputs.forEach(input => {
            if (input.name) {
                data[input.name] = input.value;
            }
        });

        // Get any custom data attributes
        const customElements = document.querySelectorAll('[data-custom-value]');
        customElements.forEach(element => {
            const key = element.dataset.customKey || element.id;
            const value = element.dataset.customValue;
            if (key) {
                data[key] = value;
            }
        });

        return Object.keys(data).length > 0 ? data : undefined;
    }

    function sendMessage(data) {
        if (isDisposed) return;

        try {
            console.log('Sending message to extension:', data);
            vscode.postMessage(data);

            // Mark as disposed to prevent further interactions
            isDisposed = true;

            // Clean up
            cleanup();

        } catch (error) {
            console.error('Failed to send message:', error);
        }
    }

    function handleBeforeUnload() {
        cleanup();
    }

    function cleanup() {
        if (timeoutInterval) {
            clearInterval(timeoutInterval);
            timeoutInterval = null;
        }

        // Disable all interactive elements
        const interactiveElements = document.querySelectorAll('button, input, textarea, select');
        interactiveElements.forEach(element => {
            element.disabled = true;
        });

        console.log('Popup cleaned up');
    }

    // Utility functions
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    function throttle(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    // Error handling
    window.addEventListener('error', (event) => {
        console.error('Popup error:', event.error);

        if (!isDisposed) {
            const errorData = {
                type: 'error',
                error: {
                    message: event.error?.message || 'Unknown error',
                    stack: event.error?.stack,
                    filename: event.filename,
                    lineno: event.lineno,
                    colno: event.colno
                },
                timestamp: Date.now()
            };

            try {
                vscode.postMessage(errorData);
            } catch (e) {
                console.error('Failed to report error:', e);
            }
        }
    });

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializePopup);
    } else {
        initializePopup();
    }

    // Expose utilities for potential custom extensions
    window.PopupUtils = {
        sendCustomMessage: function(data) {
            if (!isDisposed) {
                sendMessage({ type: 'custom', data, timestamp: Date.now() });
            }
        },

        updateContent: function(newContent) {
            const messageElement = document.querySelector('.popup-message');
            if (messageElement && !isDisposed) {
                messageElement.innerHTML = newContent;
            }
        },

        addButton: function(buttonConfig) {
            const actionsContainer = document.querySelector('.popup-actions');
            if (actionsContainer && !isDisposed) {
                const button = document.createElement('button');
                button.className = `popup-button popup-button--${buttonConfig.style || 'secondary'}`;
                button.dataset.buttonId = buttonConfig.id;
                button.dataset.action = buttonConfig.action || '';
                button.textContent = buttonConfig.label;
                button.addEventListener('click', handleButtonClick);
                actionsContainer.appendChild(button);
            }
        }
    };

    console.log('Interactive MCP Popup script loaded');
})();