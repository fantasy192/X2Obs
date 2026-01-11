# X2Flow
X2Flow 允许用户一键将 Twitter/X 的推文和串推保存为本地 Markdown 文件，或同步到 FlowUs 笔记中。



**Privacy Policy for X2Flow**

**Last Updated:** January 11, 2026

**1. Introduction** X2Flow ("we", "us", or "our") is committed to protecting your privacy. This Privacy Policy explains how our Chrome extension collects, uses, and safeguards your information. The extension's single purpose is to allow users to save Twitter/X tweets to local Markdown files or sync them to FlowUs.

**2. Information We Collect and Use**

- **Website Content (Twitter/X Data):** We access the content of the tweets you select (including text, images, and videos) solely for the purpose of converting them into Markdown format or sending them to your FlowUs account upon your request.
- **Authentication Information (FlowUs Token):** To sync data with FlowUs, we store your FlowUs API Token and Target Page ID. This information is stored locally on your device using `chrome.storage.sync` and is only transmitted to the official FlowUs API (`api.flowus.cn`).
- **Browsing Data:** We do not track your browsing history. The `activeTab` and `scripting` permissions are used strictly to identify the tweet you wish to save when you trigger the extension.

**3. Permissions Justification**

- **Storage:** Used exclusively to save your preferences, FlowUs API Token, and Target Page ID locally so you don't need to re-enter them.
- **Host Permissions (Twitter/X & FlowUs):** Used to extract tweet data from `twitter.com` or `x.com` and, if you choose, to send that data to `api.flowus.cn`.
- **Downloads:** Used to save the generated `.md` files and media files directly to your computer.

**4. Data Security** We do not sell, trade, or otherwise transfer your personally identifiable information to outside parties. Your FlowUs Token is stored within your browser's local storage and is never sent to any server other than the official FlowUs API.

**5. Contact** If you have any questions about this Privacy Policy, please contact us via the support email provided on the Chrome Web Store.
