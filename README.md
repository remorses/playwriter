<div align='center'>
    <br/>
    <br/>
    <h3>playwriter</h3>
    <p>project under development</p>
    <br/>
    <br/>
</div>

## Comparison

### BrowserMCP

Playwriter has access to the full playwright API available, it can send any CDP command via the playwright methods. It only uses 1 tool `execute` to send playwright code snippets. This means that the LLM can reuse its knowledge about playwright and less context window is used to expose browser automations tools.

Playwriter is also more capable because it exposes the full playwright API instead of only a few tools.

For comparison here are the tools supported by BrowserMCP:

Navigation:

- `browsermcp_browser_navigate` - Navigate to a URL
- `browsermcp_browser_go_back` - Go back to the previous page
- `browsermcp_browser_go_forward` - Go forward to the next page
  Page Inspection:
- `browsermcp_browser_snapshot` - Capture accessibility snapshot of the current page (use this to get references to elements)
- `browsermcp_browser_screenshot` - Take a screenshot of the current page
- `browsermcp_browser_get_console_logs` - Get console logs from the browser
  Interactions:
- `browsermcp_browser_click` - Click on an element (requires element reference from snapshot)
- `browsermcp_browser_hover` - Hover over an element
- `browsermcp_browser_type` - Type text into an editable element (with optional submit)
- `browsermcp_browser_select_option` - Select an option in a dropdown
- `browsermcp_browser_press_key` - Press a key on the keyboard
  Utilities:
- `browsermcp_browser_wait` - Wait for a specified time in seconds
