import * as vscode from 'vscode';
import { micromark } from 'micromark';

export interface PopupConfig {
    title?: string;
    content: string;
    type?: 'question' | 'input' | 'confirmation';
    buttons?: Array<{
        id: string;
        label: string;
        style?: 'primary' | 'secondary' | 'danger';
        action?: string;
    }>;
    inputPlaceholder?: string;
    metadata?: any;
    timeout?: number;
}

export class PopupWebviewProvider {
    private context: vscode.ExtensionContext;
    private config: PopupConfig;

    constructor(context: vscode.ExtensionContext, config: PopupConfig) {
        this.context = context;
        this.config = { ...config, type: config.type || 'question' };
    }

    async createWebview(): Promise<vscode.WebviewPanel> {
        const panel = vscode.window.createWebviewPanel(
            'interactiveMcpPopup',
            this.config.title || 'AI Message',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.context.extensionUri, 'media')
                ]
            }
        );

        // Set the HTML content
        panel.webview.html = this.getWebviewContent(panel.webview);

        return panel;
    }

    private getWebviewContent(webview: vscode.Webview): string {
        // Get URIs for resources
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'popup.css')
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'popup.js')
        );

        // Generate buttons HTML (not used for input type)
        let buttonsHtml = '';
        let isQuestionDefault = false;

        if (this.config.type !== 'input') {
            if (this.config.buttons && this.config.buttons.length > 0) {
                buttonsHtml = this.config.buttons.map(button => {
                    return `
                    <button
                        class="popup-button popup-button--${button.style || 'primary'}"
                        data-button-id="${button.id}"
                        data-action="${button.action || ''}"
                    >
                        ${this.escapeHtml(button.label)}
                    </button>
                `;
                }).join('');
            } else if (this.config.type === 'question') {
                // Default buttons for question type when no buttons are provided
                isQuestionDefault = true;
                buttonsHtml = `
                    <div class="default-buttons">
                        <button
                            class="popup-button popup-button--secondary"
                            data-button-id="cancel"
                            data-action="cancel"
                        >
                            Cancel
                        </button>
                        <button
                            class="popup-button popup-button--primary"
                            data-button-id="ok"
                            data-action="ok"
                        >
                            OK
                        </button>
                    </div>
                `;
            }
        }

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource} 'unsafe-inline';">
            <link href="${styleUri}" rel="stylesheet">
            <title>${this.escapeHtml(this.config.title || 'AI Message')}</title>
        </head>
        <body>
            <div class="popup-container">
                <div class="popup-header">
                    <h2 class="popup-title">${this.escapeHtml(this.config.title || 'AI Message')}</h2>
                    <button class="popup-close" id="closeButton" title="Close">×</button>
                </div>

                <div class="popup-content">
                    <div class="popup-message">
                        ${this.formatContent(this.config.content)}
                    </div>

                    ${this.config.metadata ? `
                        <div class="popup-metadata">
                            <details>
                                <summary>Additional Information</summary>
                                <pre>${this.escapeHtml(JSON.stringify(this.config.metadata, null, 2))}</pre>
                            </details>
                        </div>
                    ` : ''}

                    ${this.config.type === 'input' ? `
                        <div class="popup-input-area" id="inputArea">
                            <textarea
                                id="inputTextArea"
                                placeholder="${this.escapeHtml(this.config.inputPlaceholder || 'Enter text...')}"
                                rows="4"
                                class="popup-textarea"
                            ></textarea>
                        </div>
                    ` : ''}
                </div>

                <div class="popup-actions${this.config.type === 'input' ? ' input-actions' : (isQuestionDefault ? ' question-default' : '')}">
                    ${buttonsHtml}
                    ${this.config.type === 'input' ? `
                        <button
                            class="popup-button popup-button--secondary"
                            id="cancelInputButton"
                        >
                            Cancel
                        </button>
                        <button
                            class="popup-button popup-button--primary"
                            id="sendInputButton"
                        >
                            Send
                        </button>
                    ` : ''}
                </div>

                ${this.config.type !== 'input' ? `
                <div class="popup-custom-text">
                    <textarea
                        id="customTextInput"
                        placeholder="Enter your custom response here..."
                        rows="3"
                        class="popup-textarea"
                        style="display: none;"
                    ></textarea>
                    <div class="popup-custom-actions">
                        <button
                            class="popup-button popup-button--custom-text"
                            id="customTextButton"
                            data-action="custom-text"
                        >
                            Custom text
                        </button>
                        <div class="custom-action-buttons" id="customActionButtons" style="display: none;">
                            <button
                                class="popup-button popup-button--secondary"
                                id="cancelCustomTextButton"
                            >
                                Cancel
                            </button>
                            <button
                                class="popup-button popup-button--primary"
                                id="sendCustomTextButton"
                            >
                                Send
                            </button>
                        </div>
                    </div>
                </div>` : ''}

                ${this.config.timeout ? `
                    <div class="popup-footer">
                        <span class="popup-timeout">
                            <span id="timeoutDisplay">Timeout: ${Math.ceil(this.config.timeout / 1000)}s</span>
                        </span>
                    </div>
                ` : ''}
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                const popupConfig = ${JSON.stringify(this.config)};

                // Test if vscode API is working
                try {
                    vscode.postMessage({
                        type: 'debug',
                        message: 'Inline script executed successfully',
                        hasVscode: !!vscode,
                        hasConfig: !!popupConfig
                    });
                } catch (error) {
                    console.error('Failed to post initial message:', error);
                }
            </script>
            <script src="${scriptUri}"></script>
        </body>
        </html>`;
    }

    private formatContent(content: string): string {
        // Use micromark for proper Markdown parsing
        return micromark(content);
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}