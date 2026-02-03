import { expect, test } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { formatHtmlForPrompt } from './htmlrewrite.js'

test('formatHtmlForPrompt', async () => {
  const assetUrl = new URL('./assets/framer.html', import.meta.url)
  const assetPath = fileURLToPath(assetUrl)
  if (!fs.existsSync(assetPath)) {
    return
  }
  const html = fs.readFileSync(assetPath, 'utf-8')
  const newHtml = await formatHtmlForPrompt({ html })
  expect(newHtml).toMatchInlineSnapshot(
    `
    "<!doctype html>
    <html data-redirect-timezone="1">
     <div data-framer-hydrate-v2="{&quot;routeId&quot;:&quot;Zw20hns9v&quot;,&quot;localeId&quot;:&quot;default&quot;,&quot;breakpoints&quot;:[{&quot;hash&quot;:&quot;2ngqvi&quot;,&quot;mediaQuery&quot;:&quot;(min-width: 1200px)&quot;},{&quot;hash&quot;:&quot;11ziuji&quot;,&quot;mediaQuery&quot;:&quot;(min-width: 810px) and (max-width: 1199.98px)&quot;},{&quot;hash&quot;:...237 more characters" data-framer-ssr-released-at="2026-01-14T12:43:55.253Z" data-framer-page-optimized-at="2026-01-14T15:47:27.367Z" data-framer-generated-page="">
      <div data-layout-template="true" data-selection="true">
       <div>
        <nav data-framer-name="Desktop Nav" data-hide-scrollbars="true">
         <div data-framer-name="Wrapper">
          <div data-framer-name="Logo + CTA">
           <a data-framer-name="On" data-highlight="true" href="./" data-framer-page-link-current="true"></a>
           <div data-framer-appear-id="rdbkdo" data-framer-name="LoggedOut">
            <div data-framer-name="Log in" name="Log in">
             <div name="Log in" data-framer-name="Login" data-highlight="true">
              <div data-framer-name="Start for free" name="Start for free">
               <a name="Start for free" data-signup-debug-id="header-sign-up" data-framer-name="Label" data-highlight="true" href="https://framer.com/r/login">
                <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
                 <div>Log in</div>
                </div>
               </a>
              </div>
             </div>
            </div>
            <div data-framer-name="Sign up" name="Sign up">
             <div name="Sign up" data-signup-debug-id="header-sign-up" data-framer-name="Signup" data-highlight="true">
              <div data-framer-name="Start for free" name="Start for free">
               <a name="Start for free" data-signup-debug-id="header-sign-up" data-framer-name="Button" data-highlight="true" href="https://www.framer.com/r/signup/">
                <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
                 <div>Sign up</div>
                </div>
               </a>
              </div>
             </div>
            </div>
           </div>
           <div data-framer-name="Links: Brand Jorn">
            <div data-framer-name="Link: Copy" name="Link: Copy">
             <a name="Link: Copy" data-framer-name="Large" data-highlight="true">
              <div data-framer-name="Topbar Links Text Jorn">
               <div data-framer-component-type="RichTextContainer">
                <p>Copy</p>
               </div>
               <div data-framer-component-type="RichTextContainer">
                <p>Logo as SVG</p>
               </div>
              </div>
             </a>
            </div>
            <div data-framer-name="Link: Brand" name="Link: Brand">
             <a name="Link: Brand" data-framer-name="Large" data-highlight="true" href="./brand">
              <div data-framer-name="Topbar Links Text Jorn">
               <div data-framer-component-type="RichTextContainer">
                <p>Brand</p>
               </div>
               <div data-framer-component-type="RichTextContainer">
                <p>Guidelines</p>
               </div>
              </div>
             </a>
            </div>
           </div>
          </div>
          <div data-framer-appear-id="z52upp" data-framer-name="Links" data-hide-scrollbars="true">
           <div data-framer-appear-id="1suul34" data-framer-name="Features" name="Features">
            <a name="Features" data-framer-name="Label" data-highlight="true">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Product</div>
             </div>
            </a>
           </div>
           <div data-framer-appear-id="xxq6xe" data-framer-name="Teams" name="Teams">
            <a name="Teams" data-framer-name="Label" data-highlight="true">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Teams</div>
             </div>
            </a>
           </div>
           <div data-framer-appear-id="17czzg4" data-framer-name="Resources" name="Resources">
            <a name="Resources" data-framer-name="Label" data-highlight="true">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Resources</div>
             </div>
            </a>
           </div>
           <div data-framer-appear-id="14dr99a" data-framer-name="Community" name="Community">
            <a name="Community" data-framer-name="Label" data-highlight="true">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Community</div>
             </div>
            </a>
           </div>
           <div data-framer-appear-id="jblisq" data-framer-name="Help" name="Help">
            <a name="Help" data-framer-name="Label" data-highlight="true">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Support</div>
             </div>
            </a>
           </div>
           <div data-framer-appear-id="3bosee" data-framer-name="Enterprise" name="Enterprise">
            <a name="Enterprise" data-framer-name="Label" data-highlight="true" href="./enterprise/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Enterprise</div>
             </div>
            </a>
           </div>
           <div data-framer-appear-id="h4b5w4" data-framer-name="Pricing" name="Pricing">
            <a name="Pricing" data-framer-name="Label" data-highlight="true" href="./pricing">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Pricing</div>
             </div>
            </a>
           </div>
          </div>
         </div>
        </nav>
        <nav data-framer-name="Mobile Nav" data-hide-scrollbars="true">
         <div data-framer-name="Wrapper">
          <div data-framer-name="Logo + CTA">
           <a data-framer-name="On" data-highlight="true" href="./" data-framer-page-link-current="true"></a>
          </div>
         </div>
        </nav>
        <nav data-framer-name="Mobile Nav" data-hide-scrollbars="true">
         <div data-framer-name="Wrapper">
          <div data-framer-name="Logo + CTA">
           <a data-framer-name="On" data-highlight="true" href="./" data-framer-page-link-current="true"></a>
          </div>
         </div>
        </nav>
       </div>
       <div data-framer-name="Developers Sidebar" name="Developers Sidebar">
        <nav name="Developers Sidebar" data-framer-name="Sidebar">
         <div data-hide-scrollbars="true">
          <div data-border="true" data-framer-name="Developers">
           <button aria-label="Search Icon"></button>
           <div data-framer-component-type="RichTextContainer">
            <p>Search...</p>
           </div>
          </div>
          <div>
           <div data-framer-name="Fetch">
            <div data-framer-component-type="RichTextContainer">
             <p>Get Started</p>
            </div>
            <div>
             <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
              <a data-styles-preset="QITH89Isy" href="./developers/">Overview</a>
             </div>
             <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
              <a data-styles-preset="QITH89Isy" href="./developers/comparison">Compare</a>
             </div>
             <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
              <a data-styles-preset="QITH89Isy" href="./developers/faq">FAQ</a>
             </div>
            </div>
           </div>
           <div data-framer-name="Closed">
            <div data-framer-component-type="RichTextContainer">
             <a data-styles-preset="uexyNUZEC" href="./">Plugins</a>
            </div>
            <div>
             <div>
              <div data-framer-name="Nav Item">
               <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                <a data-styles-preset="QITH89Isy" href="./developers/plugins-introduction">Introduction</a>
               </div>
              </div>
              <div data-framer-name="Nav Item">
               <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                <a data-styles-preset="QITH89Isy" href="./developers/plugins-quick-start">Quick Start</a>
               </div>
              </div>
              <div data-framer-name="Nav Item">
               <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                <a data-styles-preset="QITH89Isy" href="./developers/publishing">Publishing</a>
               </div>
              </div>
              <div data-framer-name="Nav Item">
               <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                <a data-styles-preset="QITH89Isy" href="./developers/changelog">Changelog</a>
               </div>
              </div>
              <div data-framer-name="Nav Item">
               <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                <a data-styles-preset="QITH89Isy" href="./developers/reference">Reference</a>
               </div>
              </div>
             </div>
             <div data-highlight="true">
              <div data-framer-component-type="RichTextContainer">
               <p>Guides</p>
              </div>
             </div>
            </div>
           </div>
           <div data-framer-name="Fetch">
            <div data-framer-component-type="RichTextContainer">
             <p>Fetch</p>
            </div>
            <div>
             <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
              <a data-styles-preset="QITH89Isy" href="./developers/fetch-introduction">Introduction</a>
             </div>
             <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
              <a data-styles-preset="QITH89Isy" href="./developers/fetch-examples">Examples</a>
             </div>
            </div>
           </div>
           <div data-framer-name="Components">
            <div data-framer-component-type="RichTextContainer">
             <p>Components</p>
            </div>
            <div>
             <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
              <a data-styles-preset="QITH89Isy" href="./developers/components-introduction">Introduction</a>
             </div>
             <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
              <a data-styles-preset="QITH89Isy" href="./developers/component-examples">Examples</a>
             </div>
             <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
              <a data-styles-preset="QITH89Isy" href="./developers/component-sharing">Asset Sharing</a>
             </div>
             <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
              <a data-styles-preset="QITH89Isy" href="./developers/auto-sizing">Auto-Sizing</a>
             </div>
             <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
              <a data-styles-preset="QITH89Isy" href="./developers/property-controls">Property Controls</a>
             </div>
             <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
              <a data-styles-preset="QITH89Isy" href="./developers/components-reference">Reference</a>
             </div>
            </div>
           </div>
           <div data-framer-name="Overrides">
            <div data-framer-component-type="RichTextContainer">
             <p>Overrides</p>
            </div>
            <div>
             <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
              <a data-styles-preset="QITH89Isy" href="./developers/overrides-introduction">Introduction</a>
             </div>
             <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
              <a data-styles-preset="QITH89Isy" href="./developers/overrides-examples">Examples</a>
             </div>
            </div>
           </div>
          </div>
         </div>
        </nav>
       </div>
       <div data-framer-layout-hint-center-x="true" data-framer-name="Developers Mobile Nav" name="Developers Mobile Nav">
        <div name="Developers Mobile Nav" data-framer-name="Phone">
         <div data-framer-name="Parent">
          <div data-border="true" data-framer-name="Inner">
           <div data-framer-name="On" data-highlight="true">
            <div data-framer-component-type="RichTextContainer">
             <a data-styles-preset="FYtNM2koB" href="./developers/">Developers</a>
            </div>
           </div>
           <div data-framer-name="Dropdown">
            <div data-framer-name="Variant 1">
             <button aria-label="Search Icon">
              <img alt="icon entry point for Site Search">
             </button>
             <div data-framer-name="Search Input">
              <div data-framer-component-type="RichTextContainer">
               <h6>Search</h6>
              </div>
             </div>
            </div>
           </div>
          </div>
          <div data-framer-name="Sidebar Parent">
           <nav data-framer-name="Mobile">
            <div data-hide-scrollbars="true">
             <div data-border="true" data-framer-name="Developers">
              <button aria-label="Search Icon"></button>
              <div data-framer-component-type="RichTextContainer">
               <p>Search...</p>
              </div>
             </div>
             <div>
              <div data-framer-name="Fetch">
               <div data-framer-component-type="RichTextContainer">
                <p>Get Started</p>
               </div>
               <div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/">Overview</a>
                </div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/comparison">Compare</a>
                </div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/faq">FAQ</a>
                </div>
               </div>
              </div>
              <div data-framer-name="Closed">
               <div data-framer-component-type="RichTextContainer">
                <a data-styles-preset="uexyNUZEC" href="./">Plugins</a>
               </div>
               <div>
                <div>
                 <div data-framer-name="Nav Item">
                  <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                   <a data-styles-preset="QITH89Isy" href="./developers/plugins-introduction">Introduction</a>
                  </div>
                 </div>
                 <div data-framer-name="Nav Item">
                  <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                   <a data-styles-preset="QITH89Isy" href="./developers/plugins-quick-start">Quick Start</a>
                  </div>
                 </div>
                 <div data-framer-name="Nav Item">
                  <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                   <a data-styles-preset="QITH89Isy" href="./developers/publishing">Publishing</a>
                  </div>
                 </div>
                 <div data-framer-name="Nav Item">
                  <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                   <a data-styles-preset="QITH89Isy" href="./developers/changelog">Changelog</a>
                  </div>
                 </div>
                 <div data-framer-name="Nav Item">
                  <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                   <a data-styles-preset="QITH89Isy" href="./developers/reference">Reference</a>
                  </div>
                 </div>
                </div>
                <div data-highlight="true">
                 <div data-framer-component-type="RichTextContainer">
                  <p>Guides</p>
                 </div>
                </div>
               </div>
              </div>
              <div data-framer-name="Fetch">
               <div data-framer-component-type="RichTextContainer">
                <p>Fetch</p>
               </div>
               <div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/fetch-introduction">Introduction</a>
                </div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/fetch-examples">Examples</a>
                </div>
               </div>
              </div>
              <div data-framer-name="Components">
               <div data-framer-component-type="RichTextContainer">
                <p>Components</p>
               </div>
               <div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/components-introduction">Introduction</a>
                </div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/component-examples">Examples</a>
                </div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/component-sharing">Asset Sharing</a>
                </div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/auto-sizing">Auto-Sizing</a>
                </div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/property-controls">Property Controls</a>
                </div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/components-reference">Reference</a>
                </div>
               </div>
              </div>
              <div data-framer-name="Overrides">
               <div data-framer-component-type="RichTextContainer">
                <p>Overrides</p>
               </div>
               <div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/overrides-introduction">Introduction</a>
                </div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/overrides-examples">Examples</a>
                </div>
               </div>
              </div>
             </div>
            </div>
           </nav>
          </div>
         </div>
        </div>
       </div>
       <div data-framer-layout-hint-center-x="true" data-framer-name="Developers Mobile Nav" name="Developers Mobile Nav">
        <div name="Developers Mobile Nav" data-framer-name="Phone">
         <div data-framer-name="Parent">
          <div data-border="true" data-framer-name="Inner">
           <div data-framer-name="On" data-highlight="true">
            <div data-framer-component-type="RichTextContainer">
             <a data-styles-preset="FYtNM2koB" href="./developers/">Developers</a>
            </div>
           </div>
           <div data-framer-name="Dropdown">
            <div data-framer-name="Variant 1">
             <button aria-label="Search Icon">
              <img alt="icon entry point for Site Search">
             </button>
             <div data-framer-name="Search Input">
              <div data-framer-component-type="RichTextContainer">
               <h6>Search</h6>
              </div>
             </div>
            </div>
           </div>
          </div>
          <div data-framer-name="Sidebar Parent">
           <nav data-framer-name="Mobile">
            <div data-hide-scrollbars="true">
             <div data-border="true" data-framer-name="Developers">
              <button aria-label="Search Icon"></button>
              <div data-framer-component-type="RichTextContainer">
               <p>Search...</p>
              </div>
             </div>
             <div>
              <div data-framer-name="Fetch">
               <div data-framer-component-type="RichTextContainer">
                <p>Get Started</p>
               </div>
               <div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/">Overview</a>
                </div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/comparison">Compare</a>
                </div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/faq">FAQ</a>
                </div>
               </div>
              </div>
              <div data-framer-name="Closed">
               <div data-framer-component-type="RichTextContainer">
                <a data-styles-preset="uexyNUZEC" href="./">Plugins</a>
               </div>
               <div>
                <div>
                 <div data-framer-name="Nav Item">
                  <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                   <a data-styles-preset="QITH89Isy" href="./developers/plugins-introduction">Introduction</a>
                  </div>
                 </div>
                 <div data-framer-name="Nav Item">
                  <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                   <a data-styles-preset="QITH89Isy" href="./developers/plugins-quick-start">Quick Start</a>
                  </div>
                 </div>
                 <div data-framer-name="Nav Item">
                  <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                   <a data-styles-preset="QITH89Isy" href="./developers/publishing">Publishing</a>
                  </div>
                 </div>
                 <div data-framer-name="Nav Item">
                  <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                   <a data-styles-preset="QITH89Isy" href="./developers/changelog">Changelog</a>
                  </div>
                 </div>
                 <div data-framer-name="Nav Item">
                  <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                   <a data-styles-preset="QITH89Isy" href="./developers/reference">Reference</a>
                  </div>
                 </div>
                </div>
                <div data-highlight="true">
                 <div data-framer-component-type="RichTextContainer">
                  <p>Guides</p>
                 </div>
                </div>
               </div>
              </div>
              <div data-framer-name="Fetch">
               <div data-framer-component-type="RichTextContainer">
                <p>Fetch</p>
               </div>
               <div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/fetch-introduction">Introduction</a>
                </div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/fetch-examples">Examples</a>
                </div>
               </div>
              </div>
              <div data-framer-name="Components">
               <div data-framer-component-type="RichTextContainer">
                <p>Components</p>
               </div>
               <div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/components-introduction">Introduction</a>
                </div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/component-examples">Examples</a>
                </div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/component-sharing">Asset Sharing</a>
                </div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/auto-sizing">Auto-Sizing</a>
                </div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/property-controls">Property Controls</a>
                </div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/components-reference">Reference</a>
                </div>
               </div>
              </div>
              <div data-framer-name="Overrides">
               <div data-framer-component-type="RichTextContainer">
                <p>Overrides</p>
               </div>
               <div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/overrides-introduction">Introduction</a>
                </div>
                <div data-framer-name="Title" data-highlight="true" data-framer-component-type="RichTextContainer">
                 <a data-styles-preset="QITH89Isy" href="./developers/overrides-examples">Examples</a>
                </div>
               </div>
              </div>
             </div>
            </div>
           </nav>
          </div>
         </div>
        </div>
       </div>
       <div data-framer-root="">
        <main data-framer-name="Main">
         <section data-framer-name="Hero">
          <header data-framer-name="Header">
           <div data-framer-appear-id="q19fl4">
            <a data-framer-name="Banner" href="./awards/">
             <div data-framer-name="Text">
              <div data-framer-appear-id="1bmd6t6" data-framer-component-type="RichTextContainer">
               <p>2025 Framer Awards</p>
              </div>
              <div data-framer-name="CTA">
               <div data-framer-component-type="RichTextContainer">
                <p data-styles-preset="vvG68NbwN">Submissions now open</p>
               </div>
              </div>
             </div>
            </a>
           </div>
           <div data-framer-appear-id="q19fl4">
            <a data-framer-name="Banner" href="./awards/">
             <div data-framer-name="Text">
              <div data-framer-appear-id="1bmd6t6" data-framer-component-type="RichTextContainer">
               <p>2025 Framer Awards</p>
              </div>
              <div data-framer-name="CTA">
               <div data-framer-component-type="RichTextContainer">
                <p data-styles-preset="vvG68NbwN">Submissions now open</p>
               </div>
              </div>
             </div>
            </a>
           </div>
           <div data-framer-name="Text">
            <div data-framer-appear-id="1rel4c6" data-framer-component-type="RichTextContainer">
             <h1 data-styles-preset="V_kfGv2cj">Build better sites, faster</h1>
            </div>
            <div data-framer-appear-id="1dlfy3o" data-framer-component-type="RichTextContainer">
             <p data-styles-preset="h59NUQSP8">Framer is the site builder trusted by leading startups and Fortune 500 companies. Build fast and scale with an integrated CMS, Analytics, Localization, and SEO.</p>
            </div>
            <div data-framer-appear-id="1dlfy3o" data-framer-component-type="RichTextContainer">
             <p data-styles-preset="h59NUQSP8">Framer is the site builder trusted by startups to Fortune 500. Build fast and scale with an integrated CMS, SEO, Analytics, and more.</p>
            </div>
           </div>
           <div data-framer-appear-id="1t92ft3" data-framer-name="Buttons">
            <a data-signup-debug-id="hero-sign-up" data-framer-name="Regular" data-highlight="true" data-reset="button" href="https://framer.com/r/signup">
             <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
              <p>Start for free</p>
             </div>
            </a>
            <a data-signup-debug-id="hero-sign-up" data-framer-name="Phone" data-highlight="true" data-reset="button" href="https://framer.com/r/signup">
             <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
              <p>Start for free</p>
             </div>
            </a>
            <a data-signup-debug-id="hero-sign-up" data-framer-name="Regular" data-highlight="true" data-reset="button" href="./ai/">
             <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
              <p>Start with AI</p>
             </div>
            </a>
            <a data-signup-debug-id="hero-sign-up" data-framer-name="Phone" data-highlight="true" data-reset="button" href="./ai/">
             <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
              <p>Start with AI</p>
             </div>
            </a>
           </div>
          </header>
          <div data-framer-name="Sites">
           <div>
            <div data-framer-name="Desktop">
             <div data-framer-name="Parallax">
              <div data-framer-name="Scroll">
               <div data-framer-appear-id="ijg9f3" data-framer-name="Column">
                <div data-border="true" data-framer-name="Card">
                 <div data-framer-name="Visual">
                  <div data-framer-name="Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Website made in Framer" data-framer-original-sizes="360px">
                   </div>
                  </div>
                 </div>
                </div>
                <div data-border="true" data-framer-name="Card">
                 <div data-framer-name="Visual">
                  <div data-framer-name="Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Website made in Framer" data-framer-original-sizes="360px">
                   </div>
                  </div>
                 </div>
                </div>
                <div data-border="true" data-framer-name="Card">
                 <div data-framer-name="Visual">
                  <div data-framer-name="Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Website made in Framer" data-framer-original-sizes="360px">
                   </div>
                  </div>
                 </div>
                </div>
               </div>
              </div>
              <div data-framer-appear-id="1s5f0ix" data-framer-name="Column">
               <div data-border="true" data-framer-name="Card">
                <div data-framer-name="Visual">
                 <div data-framer-name="Image">
                  <div data-framer-background-image-wrapper="true">
                   <img alt="Website made in Framer" data-framer-original-sizes="360px">
                  </div>
                 </div>
                </div>
               </div>
               <div data-border="true" data-framer-name="Card">
                <div data-framer-name="Visual">
                 <div data-framer-name="Image">
                  <div data-framer-background-image-wrapper="true">
                   <img alt="Website made in Framer" data-framer-original-sizes="360px">
                  </div>
                 </div>
                </div>
               </div>
               <div data-border="true" data-framer-name="Card">
                <div data-framer-name="Visual">
                 <div data-framer-name="Image">
                  <div data-framer-background-image-wrapper="true">
                   <img alt="Website made in Framer" data-framer-original-sizes="360px">
                  </div>
                 </div>
                </div>
               </div>
              </div>
              <div data-framer-name="Scroll">
               <div data-framer-appear-id="1d21oo9" data-framer-name="Phone">
                <div data-border="true" data-framer-name="Phone Card">
                 <div data-framer-name="Visual">
                  <div data-framer-name="Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Website made in Framer" data-framer-original-sizes="160px">
                   </div>
                  </div>
                 </div>
                </div>
                <div data-border="true" data-framer-name="Phone Card">
                 <div data-framer-name="Visual">
                  <div data-framer-name="Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Website made in Framer" data-framer-original-sizes="160px">
                   </div>
                  </div>
                 </div>
                </div>
                <div data-border="true" data-framer-name="Phone Card">
                 <div data-framer-name="Visual">
                  <div data-framer-name="Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Website made in Framer" data-framer-original-sizes="160px">
                   </div>
                  </div>
                 </div>
                </div>
               </div>
              </div>
              <div data-framer-appear-id="np8sg2" data-framer-name="Column">
               <div data-border="true" data-framer-name="Card">
                <div data-framer-name="Visual">
                 <div data-framer-name="Image">
                  <div data-framer-background-image-wrapper="true">
                   <img alt="Website made in Framer" data-framer-original-sizes="360px">
                  </div>
                 </div>
                </div>
               </div>
               <div data-border="true" data-framer-name="Card">
                <div data-framer-name="Visual">
                 <div data-framer-name="Pause">
                  <div data-framer-background-image-wrapper="true">
                   <img alt="Website made in Framer" data-framer-original-sizes="360px">
                  </div>
                 </div>
                </div>
               </div>
               <div data-border="true" data-framer-name="Card">
                <div data-framer-name="Visual">
                 <div data-framer-name="Image">
                  <div data-framer-background-image-wrapper="true">
                   <img alt="Website made in Framer" data-framer-original-sizes="360px">
                  </div>
                 </div>
                </div>
               </div>
              </div>
              <div data-framer-name="Scroll">
               <div data-border="true" data-framer-appear-id="whlatv" data-framer-name="Border">
                <div data-framer-name="Column">
                 <div data-border="true" data-framer-name="Card">
                  <div data-framer-name="Visual">
                   <div data-framer-name="Pause">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Website made in Framer" data-framer-original-sizes="360px">
                    </div>
                   </div>
                  </div>
                 </div>
                 <div data-border="true" data-framer-name="Card">
                  <div data-framer-name="Visual">
                   <div data-framer-name="Image">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Website made in Framer" data-framer-original-sizes="360px">
                    </div>
                   </div>
                  </div>
                 </div>
                 <div data-border="true" data-framer-name="Card">
                  <div data-framer-name="Visual">
                   <div data-framer-name="Pause">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Website made in Framer" data-framer-original-sizes="360px">
                    </div>
                   </div>
                  </div>
                 </div>
                </div>
               </div>
              </div>
              <div data-framer-appear-id="cfto1h" data-framer-name="Phone">
               <div data-border="true" data-framer-name="Phone Card">
                <div data-framer-name="Visual">
                 <div data-framer-name="Image">
                  <div data-framer-background-image-wrapper="true">
                   <img alt="Website made in Framer" data-framer-original-sizes="160px">
                  </div>
                 </div>
                </div>
               </div>
               <div data-border="true" data-framer-name="Phone Card">
                <div data-framer-name="Visual">
                 <div data-framer-name="Pause">
                  <div data-framer-background-image-wrapper="true">
                   <img alt="Website made in Framer" data-framer-original-sizes="160px">
                  </div>
                 </div>
                </div>
               </div>
               <div data-border="true" data-framer-name="Phone Card">
                <div data-framer-name="Visual">
                 <div data-framer-name="Image">
                  <div data-framer-background-image-wrapper="true">
                   <img alt="Website made in Framer" data-framer-original-sizes="160px">
                  </div>
                 </div>
                </div>
               </div>
               <div data-border="true" data-framer-name="Phone Card">
                <div data-framer-name="Visual">
                 <div data-framer-name="Image">
                  <div data-framer-background-image-wrapper="true">
                   <img alt="Website made in Framer" data-framer-original-sizes="160px">
                  </div>
                 </div>
                </div>
               </div>
              </div>
              <div data-framer-name="Scroll">
               <div data-framer-appear-id="w0kbi2" data-framer-name="Column">
                <div data-border="true" data-framer-name="Card">
                 <div data-framer-name="Visual">
                  <div data-framer-name="Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Website made in Framer" data-framer-original-sizes="360px">
                   </div>
                  </div>
                 </div>
                </div>
                <div data-border="true" data-framer-name="Card">
                 <div data-framer-name="Visual">
                  <div data-framer-name="Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Website made in Framer" data-framer-original-sizes="360px">
                   </div>
                  </div>
                 </div>
                </div>
                <div data-border="true" data-framer-name="Card">
                 <div data-framer-name="Visual">
                  <div data-framer-name="Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Website made in Framer" data-framer-original-sizes="360px">
                   </div>
                  </div>
                 </div>
                </div>
               </div>
              </div>
              <div data-framer-appear-id="9mc5sv" data-framer-name="Column">
               <div data-border="true" data-framer-name="Card">
                <div data-framer-name="Visual">
                 <div data-framer-name="Image">
                  <div data-framer-background-image-wrapper="true">
                   <img alt="Website made in Framer" data-framer-original-sizes="360px">
                  </div>
                 </div>
                </div>
               </div>
               <div data-border="true" data-framer-name="Card">
                <div data-framer-name="Visual">
                 <div data-framer-name="Image">
                  <div data-framer-background-image-wrapper="true">
                   <img alt="Website made in Framer" data-framer-original-sizes="360px">
                  </div>
                 </div>
                </div>
               </div>
               <div data-border="true" data-framer-name="Card">
                <div data-framer-name="Visual">
                 <div data-framer-name="Image">
                  <div data-framer-background-image-wrapper="true">
                   <img alt="Website made in Framer" data-framer-original-sizes="360px">
                  </div>
                 </div>
                </div>
               </div>
              </div>
              <div data-framer-name="Scroll">
               <div data-framer-appear-id="12dmdwi" data-framer-name="Column">
                <div data-border="true" data-framer-name="Card">
                 <div data-framer-name="Visual">
                  <div data-framer-name="Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Website made in Framer" data-framer-original-sizes="360px">
                   </div>
                  </div>
                 </div>
                </div>
                <div data-border="true" data-framer-name="Card">
                 <div data-framer-name="Visual">
                  <div data-framer-name="Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Website made in Framer" data-framer-original-sizes="360px">
                   </div>
                  </div>
                 </div>
                </div>
                <div data-border="true" data-framer-name="Card">
                 <div data-framer-name="Visual">
                  <div data-framer-name="Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Website made in Framer" data-framer-original-sizes="360px">
                   </div>
                  </div>
                 </div>
                </div>
               </div>
              </div>
             </div>
            </div>
            <div data-framer-name="Tablet">
             <div data-framer-name="Parallax">
              <div data-framer-name="Scroll">
               <div data-framer-appear-id="1d21oo9" data-framer-name="Phone">
                <div data-border="true" data-framer-name="Phone Card">
                 <div data-framer-name="Visual">
                  <div data-framer-name="Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Website made in Framer" data-framer-original-sizes="160px">
                   </div>
                  </div>
                 </div>
                </div>
                <div data-border="true" data-framer-name="Phone Card">
                 <div data-framer-name="Visual">
                  <div data-framer-name="Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Website made in Framer" data-framer-original-sizes="160px">
                   </div>
                  </div>
                 </div>
                </div>
                <div data-border="true" data-framer-name="Phone Card">
                 <div data-framer-name="Visual">
                  <div data-framer-name="Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Website made in Framer" data-framer-original-sizes="160px">
                   </div>
                  </div>
                 </div>
                </div>
               </div>
              </div>
              <div data-framer-appear-id="np8sg2" data-framer-name="Column">
               <div data-border="true" data-framer-name="Card">
                <div data-framer-name="Visual">
                 <div data-framer-name="Image">
                  <div data-framer-background-image-wrapper="true">
                   <img alt="Website made in Framer" data-framer-original-sizes="320px">
                  </div>
                 </div>
                </div>
               </div>
               <div data-border="true" data-framer-name="Card">
                <div data-framer-name="Visual">
                 <div data-framer-name="Pause">
                  <div data-framer-background-image-wrapper="true">
                   <img alt="Website made in Framer" data-framer-original-sizes="320px">
                  </div>
                 </div>
                </div>
               </div>
               <div data-border="true" data-framer-name="Card">
                <div data-framer-name="Visual">
                 <div data-framer-name="Image">
                  <div data-framer-background-image-wrapper="true">
                   <img alt="Website made in Framer" data-framer-original-sizes="320px">
                  </div>
                 </div>
                </div>
               </div>
              </div>
              <div data-framer-name="Scroll">
               <div data-border="true" data-framer-appear-id="whlatv" data-framer-name="Border">
                <div data-framer-name="Column">
                 <div data-border="true" data-framer-name="Card">
                  <div data-framer-name="Visual">
                   <div data-framer-name="Pause">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Website made in Framer" data-framer-original-sizes="320px">
                    </div>
                   </div>
                  </div>
                 </div>
                 <div data-border="true" data-framer-name="Card">
                  <div data-framer-name="Visual">
                   <div data-framer-name="Image">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Website made in Framer" data-framer-original-sizes="320px">
                    </div>
                   </div>
                  </div>
                 </div>
                 <div data-border="true" data-framer-name="Card">
                  <div data-framer-name="Visual">
                   <div data-framer-name="Pause">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Website made in Framer" data-framer-original-sizes="320px">
                    </div>
                   </div>
                  </div>
                 </div>
                </div>
               </div>
              </div>
              <div data-framer-appear-id="cfto1h" data-framer-name="Phone">
               <div data-border="true" data-framer-name="Phone Card">
                <div data-framer-name="Visual">
                 <div data-framer-name="Image">
                  <div data-framer-background-image-wrapper="true">
                   <img alt="Website made in Framer" data-framer-original-sizes="160px">
                  </div>
                 </div>
                </div>
               </div>
               <div data-border="true" data-framer-name="Phone Card">
                <div data-framer-name="Visual">
                 <div data-framer-name="Pause">
                  <div data-framer-background-image-wrapper="true">
                   <img alt="Website made in Framer" data-framer-original-sizes="160px">
                  </div>
                 </div>
                </div>
               </div>
               <div data-border="true" data-framer-name="Phone Card">
                <div data-framer-name="Visual">
                 <div data-framer-name="Image">
                  <div data-framer-background-image-wrapper="true">
                   <img alt="Website made in Framer" data-framer-original-sizes="160px">
                  </div>
                 </div>
                </div>
               </div>
               <div data-border="true" data-framer-name="Phone Card">
                <div data-framer-name="Visual">
                 <div data-framer-name="Image">
                  <div data-framer-background-image-wrapper="true">
                   <img alt="Website made in Framer" data-framer-original-sizes="160px">
                  </div>
                 </div>
                </div>
               </div>
              </div>
              <div data-framer-name="Scroll">
               <div data-framer-appear-id="w0kbi2" data-framer-name="Column">
                <div data-border="true" data-framer-name="Card">
                 <div data-framer-name="Visual">
                  <div data-framer-name="Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Website made in Framer" data-framer-original-sizes="320px">
                   </div>
                  </div>
                 </div>
                </div>
                <div data-border="true" data-framer-name="Card">
                 <div data-framer-name="Visual">
                  <div data-framer-name="Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Website made in Framer" data-framer-original-sizes="320px">
                   </div>
                  </div>
                 </div>
                </div>
                <div data-border="true" data-framer-name="Card">
                 <div data-framer-name="Visual">
                  <div data-framer-name="Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Website made in Framer" data-framer-original-sizes="320px">
                   </div>
                  </div>
                 </div>
                </div>
               </div>
              </div>
             </div>
            </div>
           </div>
           <div data-framer-name="Phone">
            <div data-framer-name="Parallax">
             <div data-framer-appear-id="np8sg2" data-framer-name="Column">
              <div data-border="true" data-framer-name="Card">
               <div data-framer-name="Visual">
                <div data-framer-name="Image">
                 <div data-framer-background-image-wrapper="true">
                  <img alt="Website made in Framer" data-framer-original-sizes="200px">
                 </div>
                </div>
               </div>
              </div>
              <div data-border="true" data-framer-name="Card">
               <div data-framer-name="Visual">
                <div data-framer-name="Pause">
                 <div data-framer-background-image-wrapper="true">
                  <img alt="Website made in Framer" data-framer-original-sizes="200px">
                 </div>
                </div>
               </div>
              </div>
              <div data-border="true" data-framer-name="Card">
               <div data-framer-name="Visual">
                <div data-framer-name="Image">
                 <div data-framer-background-image-wrapper="true">
                  <img alt="Website made in Framer" data-framer-original-sizes="200px">
                 </div>
                </div>
               </div>
              </div>
             </div>
             <div data-framer-name="Scroll">
              <div data-border="true" data-framer-appear-id="whlatv" data-framer-name="Border">
               <div data-framer-name="Column">
                <div data-border="true" data-framer-name="Card">
                 <div data-framer-name="Visual">
                  <div data-framer-name="Pause">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Website made in Framer" data-framer-original-sizes="200px">
                   </div>
                  </div>
                 </div>
                </div>
                <div data-border="true" data-framer-name="Card">
                 <div data-framer-name="Visual">
                  <div data-framer-name="Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Website made in Framer" data-framer-original-sizes="200px">
                   </div>
                  </div>
                 </div>
                </div>
                <div data-border="true" data-framer-name="Card">
                 <div data-framer-name="Visual">
                  <div data-framer-name="Pause">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Website made in Framer" data-framer-original-sizes="200px">
                   </div>
                  </div>
                 </div>
                </div>
               </div>
              </div>
             </div>
             <div data-framer-appear-id="cfto1h" data-framer-name="Phone">
              <div data-border="true" data-framer-name="Phone Card">
               <div data-framer-name="Visual">
                <div data-framer-name="Image">
                 <div data-framer-background-image-wrapper="true">
                  <img alt="Website made in Framer" data-framer-original-sizes="120px">
                 </div>
                </div>
               </div>
              </div>
              <div data-border="true" data-framer-name="Phone Card">
               <div data-framer-name="Visual">
                <div data-framer-name="Pause">
                 <div data-framer-background-image-wrapper="true">
                  <img alt="Website made in Framer" data-framer-original-sizes="120px">
                 </div>
                </div>
               </div>
              </div>
              <div data-border="true" data-framer-name="Phone Card">
               <div data-framer-name="Visual">
                <div data-framer-name="Image">
                 <div data-framer-background-image-wrapper="true">
                  <img alt="Website made in Framer" data-framer-original-sizes="120px">
                 </div>
                </div>
               </div>
              </div>
              <div data-border="true" data-framer-name="Phone Card">
               <div data-framer-name="Visual">
                <div data-framer-name="Image">
                 <div data-framer-background-image-wrapper="true">
                  <img alt="Website made in Framer" data-framer-original-sizes="120px">
                 </div>
                </div>
               </div>
              </div>
             </div>
            </div>
           </div>
           <div data-framer-name="Companies">
            <div data-framer-name="Grid">
             <a data-framer-name="Small" data-highlight="true" href="./stories/">
              <div data-framer-component-type="RichTextContainer">
               <p>Meet our customers</p>
              </div>
             </a>
            </div>
            <div data-framer-name="Ticker">
             <a data-framer-name="Small" data-highlight="true" href="./stories/">
              <div data-framer-component-type="RichTextContainer">
               <p>Meet our customers</p>
              </div>
             </a>
            </div>
           </div>
          </div>
         </section>
         <section data-framer-name="Design Sidebar">
          <header data-framer-name="Header">
           <div data-framer-component-type="RichTextContainer">
            <h2 data-styles-preset="Y4paqDh7P">Create, collaborate, and go live</h2>
           </div>
          </header>
          <div data-framer-name="Desktop">
           <div data-framer-name="AI">
            <div data-border="true" data-framer-name="Open">
             <div data-framer-name="Text">
              <div data-framer-component-type="RichTextContainer">
               <h3 data-styles-preset="wVtX8xMgR">
                <a data-styles-preset="uexyNUZEC" href="./#feat-ai">AI</a>
               </h3>
              </div>
              <div data-framer-component-type="RichTextContainer">
               <p data-styles-preset="kuibWYBoM">Generate site layouts and advanced components in seconds with AI, so you can skip the blank canvas and start designing with confidence.</p>
              </div>
             </div>
             <a data-framer-name="Default" data-highlight="true" href="./ai/">
              <div data-framer-component-type="RichTextContainer">
               <h3>Learn more</h3>
              </div>
             </a>
            </div>
            <div data-border="true" data-framer-name="Closed">
             <div data-framer-name="Text">
              <div data-framer-component-type="RichTextContainer">
               <h3 data-styles-preset="wVtX8xMgR">
                <a data-styles-preset="Db1qJXtpu" href="./#feat-design">Design</a>
               </h3>
              </div>
              <div data-framer-component-type="RichTextContainer">
               <p data-styles-preset="kuibWYBoM">Craft responsive layouts and bring them to life with smooth effects, interactions, and animations. Build exactly what you imagine, visually.</p>
              </div>
             </div>
             <a data-framer-name="Default" data-highlight="true" href="./design/">
              <div data-framer-component-type="RichTextContainer">
               <h3>Learn more</h3>
              </div>
             </a>
            </div>
            <div data-border="true" data-framer-name="Closed">
             <div data-framer-name="Text">
              <div data-framer-component-type="RichTextContainer">
               <h3 data-styles-preset="wVtX8xMgR">
                <a data-styles-preset="Db1qJXtpu" href="./#feat-cms">CMS</a>
               </h3>
              </div>
              <div data-framer-component-type="RichTextContainer">
               <p data-styles-preset="kuibWYBoM">Manage and update your content effortlessly with a built-in CMS. Keep your site fresh without touching code.</p>
              </div>
             </div>
             <a data-framer-name="Default" data-highlight="true" href="./scale/">
              <div data-framer-component-type="RichTextContainer">
               <h3>Learn more</h3>
              </div>
             </a>
            </div>
            <div data-border="true" data-framer-name="Closed">
             <div data-framer-name="Text">
              <div data-framer-component-type="RichTextContainer">
               <h3 data-styles-preset="wVtX8xMgR">
                <a data-styles-preset="Db1qJXtpu" href="./#feat-collab">Collaborate</a>
               </h3>
              </div>
              <div data-framer-component-type="RichTextContainer">
               <p data-styles-preset="kuibWYBoM">Whether you’re collaborating on the canvas or editing copy directly on the page, updates are seamless and handoff-free.</p>
              </div>
             </div>
             <a data-framer-name="Default" data-highlight="true" href="./collaborate/">
              <div data-framer-component-type="RichTextContainer">
               <h3>Learn more</h3>
              </div>
             </a>
            </div>
           </div>
           <div data-framer-name="Features">
            <div data-framer-name="AI">
             <div data-framer-name="Visual">
              <div data-border="true" data-framer-name="New UI" data-nosnippet="true">
               <div data-border="true" data-framer-name="Top Bar">
                <div data-framer-name="Top Bar New">
                 <div data-framer-background-image-wrapper="true">
                  <img alt="Framer UI" data-framer-original-sizes="364px">
                 </div>
                </div>
                <div data-framer-name="Avatars">
                 <div data-framer-name="Team">
                  <div data-framer-name="Avatar">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="A smiling person with short hair, wearing a dark shirt, against a backdrop of blue sky and clouds." data-framer-original-sizes="28px">
                   </div>
                  </div>
                 </div>
                 <div data-framer-name="Topbar Right Simple@2x">
                  <div data-framer-background-image-wrapper="true">
                   <img alt="Framer UI" data-framer-original-sizes="285px">
                  </div>
                 </div>
                </div>
               </div>
               <div data-framer-name="Content">
                <div data-border="true" data-framer-name="Left">
                 <div data-border="true" data-framer-name="Layout Row">
                  <div data-framer-name="Titile" data-framer-component-type="RichTextContainer">
                   <p>Wireframer</p>
                  </div>
                 </div>
                 <div data-framer-name="Response">
                  <div data-framer-name="Framer@2x">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="UI" data-framer-original-sizes="71px">
                   </div>
                  </div>
                  <div data-framer-component-type="RichTextContainer">
                   <p>
                    <span>I</span>
                    <span>created</span>
                    <span>three</span>
                    <span>unique</span>
                    <span>landing</span>
                    <span>pages</span>
                    <span>in</span>
                    <span>dark</span>
                    <span>mode</span>
                    <span>for</span>
                    <span>your</span>
                    <span>modern</span>
                    <span>design</span>
                    <span>startup:</span>
                    <span>a</span>
                    <span>main</span>
                    <span>landing</span>
                    <span>page,</span>
                    <span>a</span>
                    <span>creative-focused</span>
                    <span>page,</span>
                    <span>and</span>
                    <span>a</span>
                    <span>studio</span>
                    <span>showcase</span>
                    <span>page.</span>
                   </p>
                  </div>
                 </div>
                </div>
                <div data-framer-name="Canvas">
                 <div data-framer-name="Pages">
                  <div data-framer-name="Col">
                   <div data-framer-component-type="RichTextContainer">
                    <p>Landing Page 1</p>
                   </div>
                   <div data-framer-name="Image">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Example of a page generated by Wireframer" data-framer-original-sizes="550px">
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="Col">
                   <div data-framer-name="Text">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Landing Page 2</p>
                    </div>
                   </div>
                   <div data-border="true" data-framer-name="Image">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Example of a page generated by Wireframer" data-framer-original-sizes="550px">
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="Col">
                   <div data-framer-component-type="RichTextContainer">
                    <p>Landing Page 3</p>
                   </div>
                   <div data-framer-name="Image">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Example of a page generated by Wireframer" data-framer-original-sizes="550px">
                    </div>
                   </div>
                  </div>
                 </div>
                 <div data-border="true" data-framer-name="Toolbar">
                  <div data-framer-component-type="RichTextContainer">
                   <p>100%</p>
                  </div>
                 </div>
                </div>
               </div>
              </div>
             </div>
            </div>
            <div data-framer-name="Design">
             <div data-framer-name="Visual">
              <div data-framer-name="Start">
               <div data-border="true" data-framer-name="New UI">
                <div data-border="true" data-framer-name="Top Bar">
                 <div data-framer-name="Topbar New@2x">
                  <div data-framer-background-image-wrapper="true">
                   <img alt="Framer UI" data-framer-original-sizes="364px">
                  </div>
                 </div>
                 <div data-framer-name="Avatars">
                  <div data-framer-name="Topbar Right Simple@2x">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Framer UI" data-framer-original-sizes="285px">
                   </div>
                  </div>
                 </div>
                </div>
                <div data-framer-name="Content">
                 <div data-framer-name="Cursor">
                  <div data-framer-name="Pill">
                   <div data-framer-component-type="RichTextContainer">
                    <p>Benjamin</p>
                   </div>
                  </div>
                 </div>
                 <div data-framer-name="Cursor">
                  <div data-framer-name="Pill">
                   <div data-framer-component-type="RichTextContainer">
                    <p>Paul</p>
                   </div>
                  </div>
                 </div>
                 <div data-border="true" data-framer-name="Left">
                  <div data-framer-name="Left@2x">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Framer UI" data-framer-original-sizes="260px">
                   </div>
                  </div>
                 </div>
                 <div data-framer-name="Canvas Design">
                  <div data-border="true" data-framer-name="Toolbar">
                   <div data-framer-component-type="RichTextContainer">
                    <p>100%</p>
                   </div>
                  </div>
                  <div data-framer-name="Headers@2x">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Framer canvas" data-framer-original-sizes="776.1229px">
                   </div>
                  </div>
                 </div>
                 <div data-border="true" data-framer-name="Right">
                  <div data-framer-name="Right@2x">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Framer UI" data-framer-original-sizes="260px">
                   </div>
                  </div>
                 </div>
                </div>
               </div>
              </div>
             </div>
            </div>
            <div data-framer-name="CMS">
             <div data-framer-name="Visual">
              <div data-border="true" data-framer-name="UI">
               <div data-border="true" data-framer-name="Topbar">
                <div data-framer-name="CMS Top Bar@2x">
                 <div data-framer-background-image-wrapper="true">
                  <img alt="Framer UI" data-framer-original-sizes="430px">
                 </div>
                </div>
               </div>
               <div data-framer-name="Editor">
                <div data-border="true" data-framer-name="CMS Sidebar">
                 <div data-framer-name="CMS Sidebar@2x">
                  <div data-framer-background-image-wrapper="true">
                   <img alt="Framer UI" data-framer-original-sizes="260px">
                  </div>
                 </div>
                </div>
                <div data-framer-name="Center">
                 <div data-framer-name="CMS / Header">
                  <div data-border="true">
                   <div data-framer-component-type="RichTextContainer">
                    <p>Title</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>Image</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>Date</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>Category</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>Slug</p>
                   </div>
                  </div>
                 </div>
                 <div data-framer-name="Search Row">
                  <div data-framer-component-type="RichTextContainer">
                   <p>Search 153 items…</p>
                  </div>
                 </div>
                 <div data-framer-name="Updates List">
                  <div data-framer-name="CMS / Row">
                   <div data-border="true">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Free Custom Domains</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Jan 8, 2026</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Publishing</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>free-custom-domains</p>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="CMS / Row">
                   <div data-border="true">
                    <div data-framer-component-type="RichTextContainer">
                     <p>On-Page Editing 2.0</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Jan 8, 2026</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>CMS</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>on-page-editing-2.0</p>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="CMS / Row">
                   <div data-border="true">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Plugins 3.9: Collections</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Dec 18, 2025</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Plugins</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>plugins-3-9</p>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="CMS / Row">
                   <div data-border="true">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Custom Code</p>
                    </div>
                    <div data-framer-name="Color">
                     <div data-border="true">
                      <div data-framer-background-image-wrapper="true">
                       <img alt="Custom Code" data-framer-original-sizes="50px">
                      </div>
                     </div>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Dec 15, 2025</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Publishing</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>custom-code</p>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="CMS / Row">
                   <div data-border="true">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Flow Effect</p>
                    </div>
                    <div data-framer-name="Color">
                     <div data-border="true">
                      <div data-framer-background-image-wrapper="true">
                       <img alt="Flow Effect" data-framer-original-sizes="50px">
                      </div>
                     </div>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Dec 11, 2025</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Effects</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>flow-effect</p>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="CMS / Row">
                   <div data-border="true">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Localized Page Paths</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Dec 11, 2025</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Localization</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>localized-page-paths</p>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="CMS / Row">
                   <div data-border="true">
                    <div data-framer-component-type="RichTextContainer">
                     <p>December Update: Squircle</p>
                    </div>
                    <div data-framer-name="Color">
                     <div data-border="true">
                      <div data-framer-background-image-wrapper="true">
                       <img alt="Squircle" data-framer-original-sizes="50px">
                      </div>
                     </div>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Dec 10, 2025</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Design</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>december-update-2025</p>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="CMS / Row">
                   <div data-border="true">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Masonry Grids</p>
                    </div>
                    <div data-framer-name="Color">
                     <div data-border="true">
                      <div data-framer-background-image-wrapper="true">
                       <img alt="Masonry Grids" data-framer-original-sizes="50px">
                      </div>
                     </div>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Nov 27, 2025</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Design</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>masonry</p>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="CMS / Row">
                   <div data-border="true">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Font Drop 16</p>
                    </div>
                    <div data-framer-name="Color">
                     <div data-border="true">
                      <div data-framer-background-image-wrapper="true">
                       <img alt="Font Drop 16" data-framer-original-sizes="50px">
                      </div>
                     </div>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Nov 21, 2025</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Design</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>font-drop-16</p>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="CMS / Row">
                   <div data-border="true">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Ticker Effect</p>
                    </div>
                    <div data-framer-name="Color">
                     <div data-border="true">
                      <div data-framer-background-image-wrapper="true">
                       <img alt="Ticker FX" data-framer-original-sizes="50px">
                      </div>
                     </div>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Nov 13, 2025</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>AI</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>ticker-effect</p>
                    </div>
                   </div>
                  </div>
                 </div>
                </div>
               </div>
               <div data-framer-name="Updates Sidebar">
                <div data-border="true" data-framer-name="Overlay">
                 <div>
                  <div data-framer-background-image-wrapper="true">
                   <img alt="Framer UI" data-framer-original-sizes="550px">
                  </div>
                  <div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Title</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Free Custom Domains</p>
                    </div>
                   </div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Image</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>free-custom-domains.jpg</p>
                    </div>
                   </div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Categories</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Publishing</p>
                    </div>
                   </div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Slug</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>free-custom-domains</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>framer.com/updates/free-custom-domains</p>
                    </div>
                   </div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Content</p>
                    </div>
                    <div data-framer-name="CMS/Rich Text Toolbar">
                     <div data-framer-name="Style">
                      <div data-framer-component-type="Text">
                       <span>Paragraph</span>
                      </div>
                     </div>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>
                      Today, we’re shipping an update where we offer a free custom domain for the first year when you upgrade your site to a yearly plan. We’ve partnered with
                      <a href="https://www.hover.com/" target="_blank">Hover</a>
                      to provide a seamless flow where you can select a free or discounted domain that will be automatically connected to your Framer site after purchase. To make use of this offer, upgrade your site to a yearly plan, then head over to the Domains tab in your project settings and select the “Claim a free custom domain” option.
                     </p>
                     <ul>
                      <li data-preset-tag="p">
                       <p>This offer can be redeemed once per subscription</p>
                      </li>
                      <li data-preset-tag="p">
                       <p>This offer is available only for sites on a yearly plan</p>
                      </li>
                      <li data-preset-tag="p">
                       <p>Your domain will automatically renew at the standard rate</p>
                      </li>
                      <li data-preset-tag="p">
                       <p>Redeeming this offer forfeits the option to request a refund</p>
                      </li>
                      <li data-preset-tag="p">
                       <p>This offer is not valid in combination with a 100% discount code</p>
                      </li>
                      <li data-preset-tag="p">
                       <p>
                        Your domain and its subscription will be managed through
                        <a href="https://www.hover.com/" target="_blank">Hover</a>
                       </p>
                      </li>
                     </ul>
                    </div>
                   </div>
                  </div>
                 </div>
                </div>
               </div>
              </div>
             </div>
            </div>
            <div data-framer-name="Collaborate">
             <div data-framer-name="Visual">
              <div data-border="true" data-framer-name="UI" data-nosnippet="true">
               <div data-framer-name="Top Bar">
                <div data-framer-name="Search Bar">
                 <div data-framer-component-type="RichTextContainer">
                  <p>baseform.framer.website</p>
                 </div>
                </div>
               </div>
               <div data-framer-name="Content">
                <div data-framer-name="Top Bar">
                 <div data-framer-component-type="RichTextContainer">
                  <p>Baseform®</p>
                 </div>
                 <div>
                  <div data-framer-component-type="RichTextContainer">
                   <p>Art Direction</p>
                  </div>
                  <div data-framer-component-type="RichTextContainer">
                   <p>Visual Design</p>
                  </div>
                 </div>
                 <div>
                  <div data-framer-component-type="RichTextContainer">
                   <p>Work,</p>
                  </div>
                  <div data-framer-component-type="RichTextContainer">
                   <p>Archive,</p>
                  </div>
                  <div data-framer-component-type="RichTextContainer">
                   <p>Profile,</p>
                  </div>
                  <div data-framer-component-type="RichTextContainer">
                   <p>Journal</p>
                  </div>
                 </div>
                 <div data-framer-component-type="RichTextContainer">
                  <p>Let's Talk</p>
                 </div>
                </div>
                <div data-framer-name="Body">
                 <div data-border="true">
                  <div data-framer-name="Images">
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <h3>Latest News</h3>
                    </div>
                    <div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>View All Posts</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>→</p>
                     </div>
                    </div>
                   </div>
                   <div>
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Photo" data-framer-original-sizes="287.5px">
                    </div>
                    <div data-border="true">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Photo" data-framer-original-sizes="287.5px">
                     </div>
                    </div>
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Photo" data-framer-original-sizes="287.5px">
                    </div>
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Photo" data-framer-original-sizes="287.5px">
                    </div>
                   </div>
                  </div>
                 </div>
                </div>
               </div>
              </div>
              <div data-border="true" data-framer-name="Card">
               <div data-framer-name="Image">
                <div data-framer-background-image-wrapper="true">
                 <img alt="Framer UI" data-framer-original-sizes="256px">
                </div>
               </div>
              </div>
             </div>
             <div data-framer-name="On Page Editing">
              <div data-framer-name="Text">
               <div data-framer-name="Text 1">
                <div data-framer-component-type="RichTextContainer">
                 <p>Click to edit</p>
                </div>
                <div data-framer-component-type="RichTextContainer">
                 <p>·</p>
                </div>
                <div data-framer-component-type="RichTextContainer">
                 <p>Changes are auto-saved</p>
                </div>
               </div>
               <div data-framer-name="Text 2">
                <div data-framer-component-type="RichTextContainer">
                 <p>Site saved</p>
                </div>
                <div data-framer-component-type="RichTextContainer">
                 <p>·</p>
                </div>
                <div data-framer-component-type="RichTextContainer">
                 <p>Collaborators are notified. Changes will be visible once the project is published.</p>
                </div>
               </div>
              </div>
              <div data-framer-name="Open in Framer">
               <div data-framer-component-type="RichTextContainer">
                <p>Open in Framer</p>
               </div>
              </div>
              <div data-framer-name="Finish Editing">
               <div data-framer-component-type="RichTextContainer">
                <p>Finish Editing</p>
               </div>
              </div>
             </div>
            </div>
           </div>
          </div>
          <div data-framer-name="Phone">
           <article data-framer-name="AI">
            <div data-framer-name="Text">
             <div>
              <div data-framer-component-type="RichTextContainer">
               <h5 data-styles-preset="wVtX8xMgR">AI</h5>
              </div>
              <div data-framer-component-type="RichTextContainer">
               <p data-styles-preset="kuibWYBoM">Generate page layouts and advanced components in seconds with AI, so you can skip the blank canvas and start designing with confidence.</p>
              </div>
             </div>
             <a data-framer-name="Small" data-highlight="true" href="./ai/">
              <div data-framer-component-type="RichTextContainer">
               <p>Learn more</p>
              </div>
             </a>
            </div>
           </article>
           <article data-framer-name="AI">
            <div data-framer-name="Text">
             <div>
              <div data-framer-component-type="RichTextContainer">
               <h5 data-styles-preset="wVtX8xMgR">AI</h5>
              </div>
              <div data-framer-component-type="RichTextContainer">
               <p data-styles-preset="kuibWYBoM">Generate page layouts and advanced components in seconds with AI, so you can skip the blank canvas and start designing with confidence.</p>
              </div>
             </div>
             <a data-framer-name="Small" data-highlight="true" href="./ai/">
              <div data-framer-component-type="RichTextContainer">
               <p>Learn more</p>
              </div>
             </a>
            </div>
           </article>
           <article data-framer-name="AI">
            <div data-framer-name="Text">
             <div>
              <div data-framer-component-type="RichTextContainer">
               <h5 data-styles-preset="wVtX8xMgR">AI</h5>
              </div>
              <div data-framer-component-type="RichTextContainer">
               <p data-styles-preset="kuibWYBoM">Generate page layouts and advanced components in seconds with AI, so you can skip the blank canvas and start designing with confidence.</p>
              </div>
             </div>
             <a data-framer-name="Small" data-highlight="true" href="./ai/">
              <div data-framer-component-type="RichTextContainer">
               <p>Learn more</p>
              </div>
             </a>
            </div>
           </article>
           <article data-framer-name="Design">
            <div data-framer-name="Text">
             <div>
              <div data-framer-component-type="RichTextContainer">
               <h5 data-styles-preset="wVtX8xMgR">Design</h5>
              </div>
              <div data-framer-component-type="RichTextContainer">
               <p data-styles-preset="kuibWYBoM">Craft responsive layouts and bring them to life with smooth effects, interactions, and animations. Build exactly what you imagine, visually.</p>
              </div>
             </div>
             <a data-framer-name="Small" data-highlight="true" href="./design/">
              <div data-framer-component-type="RichTextContainer">
               <p>Learn more</p>
              </div>
             </a>
            </div>
           </article>
           <article data-framer-name="Design">
            <div data-framer-name="Text">
             <div>
              <div data-framer-component-type="RichTextContainer">
               <h5 data-styles-preset="wVtX8xMgR">Design</h5>
              </div>
              <div data-framer-component-type="RichTextContainer">
               <p data-styles-preset="kuibWYBoM">Craft responsive layouts and bring them to life with smooth effects, interactions, and animations. Build exactly what you imagine, visually.</p>
              </div>
             </div>
             <a data-framer-name="Small" data-highlight="true" href="./design/">
              <div data-framer-component-type="RichTextContainer">
               <p>Learn more</p>
              </div>
             </a>
            </div>
           </article>
           <article data-framer-name="Design">
            <div data-framer-name="Text">
             <div>
              <div data-framer-component-type="RichTextContainer">
               <h5 data-styles-preset="wVtX8xMgR">Design</h5>
              </div>
              <div data-framer-component-type="RichTextContainer">
               <p data-styles-preset="kuibWYBoM">Craft responsive layouts and bring them to life with smooth effects, interactions, and animations. Build exactly what you imagine, visually.</p>
              </div>
             </div>
             <a data-framer-name="Small" data-highlight="true" href="./design/">
              <div data-framer-component-type="RichTextContainer">
               <p>Learn more</p>
              </div>
             </a>
            </div>
           </article>
           <article data-framer-name="CMS">
            <div data-framer-name="Text">
             <div>
              <div data-framer-component-type="RichTextContainer">
               <h5 data-styles-preset="wVtX8xMgR">CMS</h5>
              </div>
              <div data-framer-component-type="RichTextContainer">
               <p data-styles-preset="kuibWYBoM">Manage and update your content effortlessly with a built-in CMS. Keep your site fresh without touching code.</p>
              </div>
             </div>
             <a data-framer-name="Small" data-highlight="true" href="./scale/">
              <div data-framer-component-type="RichTextContainer">
               <p>Learn more</p>
              </div>
             </a>
            </div>
           </article>
           <article data-framer-name="CMS">
            <div data-framer-name="Text">
             <div>
              <div data-framer-component-type="RichTextContainer">
               <h5 data-styles-preset="wVtX8xMgR">CMS</h5>
              </div>
              <div data-framer-component-type="RichTextContainer">
               <p data-styles-preset="kuibWYBoM">Manage and update your content effortlessly with a built-in CMS. Keep your site fresh without touching code.</p>
              </div>
             </div>
             <a data-framer-name="Small" data-highlight="true" href="./scale/">
              <div data-framer-component-type="RichTextContainer">
               <p>Learn more</p>
              </div>
             </a>
            </div>
           </article>
           <article data-framer-name="CMS">
            <div data-framer-name="Text">
             <div>
              <div data-framer-component-type="RichTextContainer">
               <h5 data-styles-preset="wVtX8xMgR">CMS</h5>
              </div>
              <div data-framer-component-type="RichTextContainer">
               <p data-styles-preset="kuibWYBoM">Manage and update your content effortlessly with a built-in CMS. Keep your site fresh without touching code.</p>
              </div>
             </div>
             <a data-framer-name="Small" data-highlight="true" href="./scale/">
              <div data-framer-component-type="RichTextContainer">
               <p>Learn more</p>
              </div>
             </a>
            </div>
           </article>
           <article data-framer-name="Collaborate">
            <div data-framer-name="Text">
             <div>
              <div data-framer-component-type="RichTextContainer">
               <h5 data-styles-preset="wVtX8xMgR">Collaborate</h5>
              </div>
              <div data-framer-component-type="RichTextContainer">
               <p data-styles-preset="kuibWYBoM">Whether you’re collaborating on the canvas or editing copy directly on the page, updates are seamless and handoff-free.</p>
              </div>
             </div>
             <a data-framer-name="Small" data-highlight="true" href="./scale/">
              <div data-framer-component-type="RichTextContainer">
               <p>Learn more</p>
              </div>
             </a>
            </div>
           </article>
           <article data-framer-name="Collaborate">
            <div data-framer-name="Text">
             <div>
              <div data-framer-component-type="RichTextContainer">
               <h5 data-styles-preset="wVtX8xMgR">Collaborate</h5>
              </div>
              <div data-framer-component-type="RichTextContainer">
               <p data-styles-preset="kuibWYBoM">Whether you’re collaborating on the canvas or editing copy directly on the page, updates are seamless and handoff-free.</p>
              </div>
             </div>
             <a data-framer-name="Small" data-highlight="true" href="./scale/">
              <div data-framer-component-type="RichTextContainer">
               <p>Learn more</p>
              </div>
             </a>
            </div>
           </article>
           <article data-framer-name="Collaborate">
            <div data-framer-name="Text">
             <div>
              <div data-framer-component-type="RichTextContainer">
               <h5 data-styles-preset="wVtX8xMgR">Collaborate</h5>
              </div>
              <div data-framer-component-type="RichTextContainer">
               <p data-styles-preset="kuibWYBoM">Whether you’re collaborating on the canvas or editing copy directly on the page, updates are seamless and handoff-free.</p>
              </div>
             </div>
             <a data-framer-name="Small" data-highlight="true" href="./scale/">
              <div data-framer-component-type="RichTextContainer">
               <p>Learn more</p>
              </div>
             </a>
            </div>
           </article>
          </div>
         </section>
         <section data-framer-name="Scale">
          <header data-framer-name="Header">
           <div data-framer-component-type="RichTextContainer">
            <h2 data-styles-preset="Y4paqDh7P">Scale without switching tools</h2>
           </div>
          </header>
          <div data-framer-name="Features">
           <div data-framer-name="Card">
            <div data-framer-background-image-wrapper="true">
             <img alt="3D render" data-framer-original-sizes="max((min(100vw - 80px, 1200px) - 30px) / 2, 50px)">
            </div>
            <div data-framer-name="Header">
             <div data-framer-name="Text">
              <div data-framer-component-type="RichTextContainer">
               <h6 data-styles-preset="VQBQVu8qk">Analytics &amp; insights</h6>
              </div>
              <div data-framer-component-type="RichTextContainer">
               <p data-styles-preset="kuibWYBoM">Track traffic, measure performance, and monitor conversions.</p>
              </div>
             </div>
             <a data-framer-name="Default" data-highlight="true" href="./analytics">
              <div data-framer-component-type="RichTextContainer">
               <h3>Learn more</h3>
              </div>
             </a>
            </div>
            <div data-framer-name="Visual">
             <div data-framer-name="Desktop">
              <div data-framer-name="UI">
               <div data-framer-name="Stats">
                <div data-border="true" data-framer-name="Content">
                 <p>January 14, 2026</p>
                 <div>
                  <div data-framer-component-type="RichTextContainer">
                   <p>Pageviews</p>
                  </div>
                  <div data-framer-component-type="RichTextContainer">
                   <p>258,156</p>
                  </div>
                 </div>
                 <div>
                  <div data-framer-component-type="RichTextContainer">
                   <p>Visitors</p>
                  </div>
                  <div data-framer-component-type="RichTextContainer">
                   <p>85,458</p>
                  </div>
                 </div>
                </div>
               </div>
               <div data-framer-name="Modal">
                <div data-framer-name="Card">
                 <div data-border="true">
                  <div data-framer-component-type="RichTextContainer">
                   <p>Overview</p>
                  </div>
                 </div>
                 <div>
                  <div>
                   <div data-framer-name="Device Title" data-framer-component-type="RichTextContainer">
                    <p>Live Visitors</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <h6>400</h6>
                   </div>
                  </div>
                  <div>
                   <div data-framer-name="Device Title" data-framer-component-type="RichTextContainer">
                    <p>Unique Visitors</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <h6>1.7M</h6>
                   </div>
                  </div>
                  <div>
                   <div data-framer-name="Device Title" data-framer-component-type="RichTextContainer">
                    <p>Total Pageviews</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <h6>3.2M</h6>
                   </div>
                  </div>
                 </div>
                </div>
                <div data-framer-component-type="RichTextContainer">
                 <p>330k</p>
                </div>
                <div>
                 <div data-framer-name="Card">
                  <div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>Sources</p>
                   </div>
                   <div data-framer-name="Segment Control">
                    <div data-framer-name="Hide" data-framer-component-type="RichTextContainer">
                     <p>Referrer</p>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="Analytics Group 2">
                   <div>
                    <div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>google.com</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>436K</p>
                     </div>
                    </div>
                    <div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>chatgpt.com</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>189K</p>
                     </div>
                    </div>
                    <div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>linkedin.com</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>96K</p>
                     </div>
                    </div>
                    <div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>youtube.com</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>82K</p>
                     </div>
                    </div>
                    <div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>bing.com</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>71K</p>
                     </div>
                    </div>
                    <div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>x.com</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>49K</p>
                     </div>
                    </div>
                   </div>
                  </div>
                 </div>
                 <div data-framer-name="Card">
                  <div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>Pages</p>
                   </div>
                   <div data-framer-name="Segment Control">
                    <div data-framer-name="Hide" data-framer-component-type="RichTextContainer">
                     <p>All</p>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="pages-group">
                   <div data-framer-name="Page">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Home</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>1.8M</p>
                    </div>
                   </div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>/pricing</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>156K</p>
                    </div>
                   </div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>/gallery</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>91K</p>
                    </div>
                   </div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>/updates</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>44K</p>
                    </div>
                   </div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>/features/design</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>39K</p>
                    </div>
                   </div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>/features/cms</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>27K</p>
                    </div>
                   </div>
                  </div>
                 </div>
                </div>
               </div>
              </div>
             </div>
            </div>
           </div>
           <div data-framer-name="Card">
            <div data-framer-background-image-wrapper="true">
             <img alt="3D render" data-framer-original-sizes="min(100vw - 40px, 1200px)">
            </div>
            <div data-framer-name="Header">
             <div data-framer-name="Text">
              <div data-framer-component-type="RichTextContainer">
               <h6 data-styles-preset="VQBQVu8qk">Analytics &amp; insights</h6>
              </div>
              <div data-framer-component-type="RichTextContainer">
               <p data-styles-preset="kuibWYBoM">Track traffic, measure performance, and monitor conversions.</p>
              </div>
             </div>
             <a data-framer-name="Small" data-highlight="true" href="./analytics">
              <div data-framer-component-type="RichTextContainer">
               <p>Learn more</p>
              </div>
             </a>
            </div>
            <div data-framer-name="Visual">
             <div data-framer-name="Desktop">
              <div data-framer-name="UI">
               <div data-framer-name="Stats">
                <div data-border="true" data-framer-name="Content">
                 <p>January 14, 2026</p>
                 <div>
                  <div data-framer-component-type="RichTextContainer">
                   <p>Pageviews</p>
                  </div>
                  <div data-framer-component-type="RichTextContainer">
                   <p>258,156</p>
                  </div>
                 </div>
                 <div>
                  <div data-framer-component-type="RichTextContainer">
                   <p>Visitors</p>
                  </div>
                  <div data-framer-component-type="RichTextContainer">
                   <p>85,458</p>
                  </div>
                 </div>
                </div>
               </div>
               <div data-framer-name="Modal">
                <div data-framer-name="Card">
                 <div data-border="true">
                  <div data-framer-component-type="RichTextContainer">
                   <p>Overview</p>
                  </div>
                 </div>
                 <div>
                  <div>
                   <div data-framer-name="Device Title" data-framer-component-type="RichTextContainer">
                    <p>Live Visitors</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <h6>400</h6>
                   </div>
                  </div>
                  <div>
                   <div data-framer-name="Device Title" data-framer-component-type="RichTextContainer">
                    <p>Unique Visitors</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <h6>1.7M</h6>
                   </div>
                  </div>
                  <div>
                   <div data-framer-name="Device Title" data-framer-component-type="RichTextContainer">
                    <p>Total Pageviews</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <h6>3.2M</h6>
                   </div>
                  </div>
                 </div>
                </div>
                <div data-framer-component-type="RichTextContainer">
                 <p>330k</p>
                </div>
                <div>
                 <div data-framer-name="Card">
                  <div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>Sources</p>
                   </div>
                   <div data-framer-name="Segment Control">
                    <div data-framer-name="Hide" data-framer-component-type="RichTextContainer">
                     <p>Referrer</p>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="Analytics Group 2">
                   <div>
                    <div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>google.com</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>436K</p>
                     </div>
                    </div>
                    <div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>chatgpt.com</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>189K</p>
                     </div>
                    </div>
                    <div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>linkedin.com</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>96K</p>
                     </div>
                    </div>
                    <div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>youtube.com</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>82K</p>
                     </div>
                    </div>
                    <div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>bing.com</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>71K</p>
                     </div>
                    </div>
                    <div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>x.com</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>49K</p>
                     </div>
                    </div>
                   </div>
                  </div>
                 </div>
                 <div data-framer-name="Card">
                  <div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>Pages</p>
                   </div>
                   <div data-framer-name="Segment Control">
                    <div data-framer-name="Hide" data-framer-component-type="RichTextContainer">
                     <p>All</p>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="pages-group">
                   <div data-framer-name="Page">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Home</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>1.8M</p>
                    </div>
                   </div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>/pricing</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>156K</p>
                    </div>
                   </div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>/gallery</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>91K</p>
                    </div>
                   </div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>/updates</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>44K</p>
                    </div>
                   </div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>/features/design</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>39K</p>
                    </div>
                   </div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>/features/cms</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>27K</p>
                    </div>
                   </div>
                  </div>
                 </div>
                </div>
               </div>
              </div>
             </div>
            </div>
           </div>
           <div data-framer-name="Card">
            <div data-framer-background-image-wrapper="true">
             <img alt="3D render" data-framer-original-sizes="min(100vw - 80px, 1200px)">
            </div>
            <div data-framer-name="Header">
             <div data-framer-name="Text">
              <div data-framer-component-type="RichTextContainer">
               <h6 data-styles-preset="VQBQVu8qk">Analytics &amp; insights</h6>
              </div>
              <div data-framer-component-type="RichTextContainer">
               <p data-styles-preset="kuibWYBoM">Track traffic, measure performance, and monitor conversions.</p>
              </div>
             </div>
             <a data-framer-name="Default" data-highlight="true" href="./analytics">
              <div data-framer-component-type="RichTextContainer">
               <h3>Learn more</h3>
              </div>
             </a>
            </div>
            <div data-framer-name="Visual">
             <div data-framer-name="Desktop">
              <div data-framer-name="UI">
               <div data-framer-name="Stats">
                <div data-border="true" data-framer-name="Content">
                 <p>January 14, 2026</p>
                 <div>
                  <div data-framer-component-type="RichTextContainer">
                   <p>Pageviews</p>
                  </div>
                  <div data-framer-component-type="RichTextContainer">
                   <p>258,156</p>
                  </div>
                 </div>
                 <div>
                  <div data-framer-component-type="RichTextContainer">
                   <p>Visitors</p>
                  </div>
                  <div data-framer-component-type="RichTextContainer">
                   <p>85,458</p>
                  </div>
                 </div>
                </div>
               </div>
               <div data-framer-name="Modal">
                <div data-framer-name="Card">
                 <div data-border="true">
                  <div data-framer-component-type="RichTextContainer">
                   <p>Overview</p>
                  </div>
                 </div>
                 <div>
                  <div>
                   <div data-framer-name="Device Title" data-framer-component-type="RichTextContainer">
                    <p>Live Visitors</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <h6>400</h6>
                   </div>
                  </div>
                  <div>
                   <div data-framer-name="Device Title" data-framer-component-type="RichTextContainer">
                    <p>Unique Visitors</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <h6>1.7M</h6>
                   </div>
                  </div>
                  <div>
                   <div data-framer-name="Device Title" data-framer-component-type="RichTextContainer">
                    <p>Total Pageviews</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <h6>3.2M</h6>
                   </div>
                  </div>
                 </div>
                </div>
                <div data-framer-component-type="RichTextContainer">
                 <p>330k</p>
                </div>
                <div>
                 <div data-framer-name="Card">
                  <div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>Sources</p>
                   </div>
                   <div data-framer-name="Segment Control">
                    <div data-framer-name="Hide" data-framer-component-type="RichTextContainer">
                     <p>Referrer</p>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="Analytics Group 2">
                   <div>
                    <div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>google.com</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>436K</p>
                     </div>
                    </div>
                    <div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>chatgpt.com</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>189K</p>
                     </div>
                    </div>
                    <div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>linkedin.com</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>96K</p>
                     </div>
                    </div>
                    <div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>youtube.com</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>82K</p>
                     </div>
                    </div>
                    <div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>bing.com</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>71K</p>
                     </div>
                    </div>
                    <div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>x.com</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>49K</p>
                     </div>
                    </div>
                   </div>
                  </div>
                 </div>
                 <div data-framer-name="Card">
                  <div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>Pages</p>
                   </div>
                   <div data-framer-name="Segment Control">
                    <div data-framer-name="Hide" data-framer-component-type="RichTextContainer">
                     <p>All</p>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="pages-group">
                   <div data-framer-name="Page">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Home</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>1.8M</p>
                    </div>
                   </div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>/pricing</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>156K</p>
                    </div>
                   </div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>/gallery</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>91K</p>
                    </div>
                   </div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>/updates</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>44K</p>
                    </div>
                   </div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>/features/design</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>39K</p>
                    </div>
                   </div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>/features/cms</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>27K</p>
                    </div>
                   </div>
                  </div>
                 </div>
                </div>
               </div>
              </div>
             </div>
             <div data-framer-name="Phone">
              <div data-framer-background-image-wrapper="true">
               <img alt="Framer UI" data-framer-original-sizes="560px">
              </div>
             </div>
            </div>
           </div>
           <div data-framer-name="Card">
            <div data-framer-background-image-wrapper="true">
             <img alt="3D render" data-framer-original-sizes="max((min(100vw - 80px, 1200px) - 30px) / 2, 50px)">
            </div>
            <div data-framer-name="Header">
             <div data-framer-name="Text">
              <div data-framer-component-type="RichTextContainer">
               <h6 data-styles-preset="VQBQVu8qk">A/B Testing &amp; optimization</h6>
              </div>
              <div data-framer-component-type="RichTextContainer">
               <p data-styles-preset="kuibWYBoM">A/B testing, funnels, and built-in growth insights.</p>
              </div>
             </div>
             <a data-framer-name="Default" data-highlight="true" href="./analytics">
              <div data-framer-component-type="RichTextContainer">
               <h3>Learn more</h3>
              </div>
             </a>
            </div>
            <div data-framer-name="Visual">
             <div data-framer-name="Desktop">
              <div data-border="true">
               <div>
                <div data-border="true">
                 <div data-border="true">
                  <div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>Pages</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>Layers</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>Assets</p>
                   </div>
                  </div>
                 </div>
                 <div>
                  <div data-border="true">
                   <div data-framer-component-type="RichTextContainer">
                    <p>Design</p>
                   </div>
                  </div>
                  <div data-framer-component-type="RichTextContainer">
                   <p>Pages</p>
                  </div>
                  <div data-framer-component-type="RichTextContainer">
                   <p>Home</p>
                  </div>
                  <div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>A</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Control</p>
                    </div>
                   </div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>B</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Version B</p>
                    </div>
                   </div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>C</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Version C</p>
                    </div>
                   </div>
                  </div>
                  <div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>/pricing</p>
                    </div>
                    <div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>A</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>B</p>
                     </div>
                    </div>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>/features</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>/blog</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>/about</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>/404</p>
                   </div>
                  </div>
                 </div>
                </div>
                <div data-framer-name="Desktop">
                 <div data-framer-name="Bar">
                  <div>
                   <div data-framer-name="iPhone 12" data-framer-component-type="RichTextContainer">
                    <p>Desktop</p>
                   </div>
                   <div data-framer-name="iPhone 12" data-framer-component-type="RichTextContainer">
                    <p>·</p>
                   </div>
                   <div data-framer-name="iPhone 12" data-framer-component-type="RichTextContainer">
                    <p>1200</p>
                   </div>
                  </div>
                 </div>
                 <div data-framer-name="Page">
                  <div data-framer-name="Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Framer website" data-framer-original-sizes="347px">
                   </div>
                  </div>
                 </div>
                </div>
               </div>
              </div>
             </div>
            </div>
           </div>
           <div data-framer-name="Card">
            <div data-framer-background-image-wrapper="true">
             <img alt="3D render" data-framer-original-sizes="min(100vw - 40px, 1200px)">
            </div>
            <div data-framer-name="Header">
             <div data-framer-name="Text">
              <div data-framer-component-type="RichTextContainer">
               <h6 data-styles-preset="VQBQVu8qk">A/B Testing &amp; optimization</h6>
              </div>
              <div data-framer-component-type="RichTextContainer">
               <p data-styles-preset="kuibWYBoM">A/B testing, funnels, and built-in growth insights.</p>
              </div>
             </div>
             <a data-framer-name="Small" data-highlight="true" href="./analytics">
              <div data-framer-component-type="RichTextContainer">
               <p>Learn more</p>
              </div>
             </a>
            </div>
            <div data-framer-name="Visual">
             <div data-framer-name="Desktop">
              <div data-border="true">
               <div>
                <div data-border="true">
                 <div data-border="true">
                  <div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>Pages</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>Layers</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>Assets</p>
                   </div>
                  </div>
                 </div>
                 <div>
                  <div data-border="true">
                   <div data-framer-component-type="RichTextContainer">
                    <p>Design</p>
                   </div>
                  </div>
                  <div data-framer-component-type="RichTextContainer">
                   <p>Pages</p>
                  </div>
                  <div data-framer-component-type="RichTextContainer">
                   <p>Home</p>
                  </div>
                  <div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>A</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Control</p>
                    </div>
                   </div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>B</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Version B</p>
                    </div>
                   </div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>C</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Version C</p>
                    </div>
                   </div>
                  </div>
                  <div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>/pricing</p>
                    </div>
                    <div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>A</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>B</p>
                     </div>
                    </div>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>/features</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>/blog</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>/about</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>/404</p>
                   </div>
                  </div>
                 </div>
                </div>
                <div data-framer-name="Desktop">
                 <div data-framer-name="Bar">
                  <div>
                   <div data-framer-name="iPhone 12" data-framer-component-type="RichTextContainer">
                    <p>Desktop</p>
                   </div>
                   <div data-framer-name="iPhone 12" data-framer-component-type="RichTextContainer">
                    <p>·</p>
                   </div>
                   <div data-framer-name="iPhone 12" data-framer-component-type="RichTextContainer">
                    <p>1200</p>
                   </div>
                  </div>
                 </div>
                 <div data-framer-name="Page">
                  <div data-framer-name="Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Framer website" data-framer-original-sizes="347px">
                   </div>
                  </div>
                 </div>
                </div>
               </div>
              </div>
             </div>
            </div>
           </div>
           <div data-framer-name="Card">
            <div data-framer-background-image-wrapper="true">
             <img alt="3D render" data-framer-original-sizes="min(100vw - 80px, 1200px)">
            </div>
            <div data-framer-name="Header">
             <div data-framer-name="Text">
              <div data-framer-component-type="RichTextContainer">
               <h6 data-styles-preset="VQBQVu8qk">A/B Testing &amp; optimization</h6>
              </div>
              <div data-framer-component-type="RichTextContainer">
               <p data-styles-preset="kuibWYBoM">A/B testing, funnels, and built-in growth insights.</p>
              </div>
             </div>
             <a data-framer-name="Default" data-highlight="true" href="./analytics">
              <div data-framer-component-type="RichTextContainer">
               <h3>Learn more</h3>
              </div>
             </a>
            </div>
            <div data-framer-name="Visual">
             <div data-framer-name="Desktop">
              <div data-border="true">
               <div>
                <div data-border="true">
                 <div data-border="true">
                  <div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>Pages</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>Layers</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>Assets</p>
                   </div>
                  </div>
                 </div>
                 <div>
                  <div data-border="true">
                   <div data-framer-component-type="RichTextContainer">
                    <p>Design</p>
                   </div>
                  </div>
                  <div data-framer-component-type="RichTextContainer">
                   <p>Pages</p>
                  </div>
                  <div data-framer-component-type="RichTextContainer">
                   <p>Home</p>
                  </div>
                  <div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>A</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Control</p>
                    </div>
                   </div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>B</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Version B</p>
                    </div>
                   </div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>C</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>Version C</p>
                    </div>
                   </div>
                  </div>
                  <div>
                   <div>
                    <div data-framer-component-type="RichTextContainer">
                     <p>/pricing</p>
                    </div>
                    <div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>A</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p>B</p>
                     </div>
                    </div>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>/features</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>/blog</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>/about</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p>/404</p>
                   </div>
                  </div>
                 </div>
                </div>
                <div data-framer-name="Desktop">
                 <div data-framer-name="Bar">
                  <div>
                   <div data-framer-name="iPhone 12" data-framer-component-type="RichTextContainer">
                    <p>Desktop</p>
                   </div>
                   <div data-framer-name="iPhone 12" data-framer-component-type="RichTextContainer">
                    <p>·</p>
                   </div>
                   <div data-framer-name="iPhone 12" data-framer-component-type="RichTextContainer">
                    <p>1200</p>
                   </div>
                  </div>
                 </div>
                 <div data-framer-name="Page">
                  <div data-framer-name="Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Framer website" data-framer-original-sizes="347px">
                   </div>
                  </div>
                 </div>
                </div>
               </div>
              </div>
             </div>
             <div data-framer-name="Phone">
              <div data-framer-background-image-wrapper="true">
               <img alt="Framer UI" data-framer-original-sizes="480px">
              </div>
             </div>
            </div>
           </div>
           <div data-framer-name="Card">
            <div data-framer-background-image-wrapper="true">
             <img alt="3D render" data-framer-original-sizes="max((min(100vw - 80px, 1200px) - 30px) / 2, 50px)">
            </div>
            <div data-framer-name="Header">
             <div data-framer-name="Text">
              <div data-framer-component-type="RichTextContainer">
               <h6 data-styles-preset="VQBQVu8qk">SEO &amp; performance</h6>
              </div>
              <div data-framer-component-type="RichTextContainer">
               <p data-styles-preset="kuibWYBoM">Optimize every page with built-in SEO settings, metadata, and blazing-fast hosting.</p>
              </div>
             </div>
             <a data-framer-name="Default" data-highlight="true" href="./scale/">
              <div data-framer-component-type="RichTextContainer">
               <h3>Learn more</h3>
              </div>
             </a>
            </div>
            <div data-framer-name="Visual">
             <div data-framer-name="Desktop">
              <div data-border="true" data-framer-name="Publish">
               <div data-framer-component-type="RichTextContainer">
                <p data-styles-preset="XHuCPIQKc">Google Lighthouse</p>
               </div>
               <div>
                <div>
                 <div data-framer-name="Default">
                  <div>0</div>
                 </div>
                 <div data-framer-component-type="RichTextContainer">
                  <p data-styles-preset="XHuCPIQKc">SEO</p>
                 </div>
                </div>
                <div>
                 <div data-framer-name="Default">
                  <div>0</div>
                 </div>
                 <div data-framer-component-type="RichTextContainer">
                  <p data-styles-preset="XHuCPIQKc">Performance</p>
                 </div>
                </div>
                <div>
                 <div data-framer-name="Default">
                  <div>0</div>
                 </div>
                 <div data-framer-component-type="RichTextContainer">
                  <p data-styles-preset="XHuCPIQKc">Accessibility</p>
                 </div>
                </div>
               </div>
              </div>
             </div>
            </div>
           </div>
           <div data-framer-name="Card">
            <div data-framer-background-image-wrapper="true">
             <img alt="3D render" data-framer-original-sizes="min(100vw - 40px, 1200px)">
            </div>
            <div data-framer-name="Header">
             <div data-framer-name="Text">
              <div data-framer-component-type="RichTextContainer">
               <h6 data-styles-preset="VQBQVu8qk">SEO &amp; performance</h6>
              </div>
              <div data-framer-component-type="RichTextContainer">
               <p data-styles-preset="kuibWYBoM">Optimize every page with built-in SEO settings, metadata, and blazing-fast hosting.</p>
              </div>
             </div>
             <a data-framer-name="Small" data-highlight="true" href="./scale/">
              <div data-framer-component-type="RichTextContainer">
               <p>Learn more</p>
              </div>
             </a>
            </div>
            <div data-framer-name="Visual">
             <div data-framer-name="Desktop">
              <div data-border="true" data-framer-name="Publish">
               <div data-framer-component-type="RichTextContainer">
                <p data-styles-preset="XHuCPIQKc">Google Lighthouse</p>
               </div>
               <div>
                <div>
                 <div data-framer-name="Default">
                  <div>0</div>
                 </div>
                 <div data-framer-component-type="RichTextContainer">
                  <p data-styles-preset="XHuCPIQKc">SEO</p>
                 </div>
                </div>
                <div>
                 <div data-framer-name="Default">
                  <div>0</div>
                 </div>
                 <div data-framer-component-type="RichTextContainer">
                  <p data-styles-preset="XHuCPIQKc">Performance</p>
                 </div>
                </div>
                <div>
                 <div data-framer-name="Default">
                  <div>0</div>
                 </div>
                 <div data-framer-component-type="RichTextContainer">
                  <p data-styles-preset="XHuCPIQKc">Accessibility</p>
                 </div>
                </div>
               </div>
              </div>
             </div>
            </div>
           </div>
           <div data-framer-name="Card">
            <div data-framer-background-image-wrapper="true">
             <img alt="3D render" data-framer-original-sizes="min(100vw - 80px, 1200px)">
            </div>
            <div data-framer-name="Header">
             <div data-framer-name="Text">
              <div data-framer-component-type="RichTextContainer">
               <h6 data-styles-preset="VQBQVu8qk">SEO &amp; performance</h6>
              </div>
              <div data-framer-component-type="RichTextContainer">
               <p data-styles-preset="kuibWYBoM">Optimize every page with built-in SEO settings, metadata, and blazing-fast hosting.</p>
              </div>
             </div>
             <a data-framer-name="Default" data-highlight="true" href="./scale/">
              <div data-framer-component-type="RichTextContainer">
               <h3>Learn more</h3>
              </div>
             </a>
            </div>
            <div data-framer-name="Visual">
             <div data-framer-name="Desktop">
              <div data-border="true" data-framer-name="Publish">
               <div data-framer-component-type="RichTextContainer">
                <p data-styles-preset="XHuCPIQKc">Google Lighthouse</p>
               </div>
               <div>
                <div>
                 <div data-framer-name="Default">
                  <div>0</div>
                 </div>
                 <div data-framer-component-type="RichTextContainer">
                  <p data-styles-preset="XHuCPIQKc">SEO</p>
                 </div>
                </div>
                <div>
                 <div data-framer-name="Default">
                  <div>0</div>
                 </div>
                 <div data-framer-component-type="RichTextContainer">
                  <p data-styles-preset="XHuCPIQKc">Performance</p>
                 </div>
                </div>
                <div>
                 <div data-framer-name="Default">
                  <div>0</div>
                 </div>
                 <div data-framer-component-type="RichTextContainer">
                  <p data-styles-preset="XHuCPIQKc">Accessibility</p>
                 </div>
                </div>
               </div>
              </div>
             </div>
             <div data-border="true" data-framer-name="Phone">
              <div data-framer-background-image-wrapper="true">
               <img alt="Lighthouse score" data-framer-original-sizes="max((min(100vw - 80px, 1200px) - 100px) / 2, 1px)">
              </div>
             </div>
            </div>
           </div>
          </div>
         </section>
         <div data-framer-name="Stories">
          <header data-framer-name="Header">
           <div data-framer-component-type="RichTextContainer">
            <h2 data-styles-preset="Y4paqDh7P">Powering ambitious teams worldwide</h2>
           </div>
          </header>
          <div aria-label="Customer Stories" data-framer-name="Sites">
           <div data-framer-name="Slideshow Desktop" name="Slideshow Desktop">
            <section>
             <ul>
              <li aria-hidden="false">
               <div data-framer-name="Perplexity">
                <a data-border="true" data-framer-name="Desktop" href="./stories/perplexity/">
                 <div data-framer-name="Left">
                  <div data-framer-name="Top">
                   <div data-framer-name="Logo">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Perplexity logo" data-framer-original-sizes="60px">
                     </div>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="Pad Quote">
                   <div data-framer-name="Quote" data-framer-component-type="RichTextContainer">
                    <p>“Framer gives us everything we need to move fast. We don’t wait on dev. We don’t compromise on design.”</p>
                   </div>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-name="User">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                    <div data-framer-name="Name">
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Henry Modisett</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Head of Design at Perplexity</p>
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="CTA 2025">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Read more</p>
                    </div>
                   </div>
                  </div>
                 </div>
                 <div data-framer-name="Right">
                  <div data-border="true" data-framer-name="Pause">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Perplexity website" data-framer-original-sizes="calc(max(1160px / 2, 1px) - 120px)">
                   </div>
                  </div>
                  <div data-framer-name="BG Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Background" data-framer-original-sizes="max(1160px / 2, 1px)">
                   </div>
                  </div>
                 </div>
                </a>
               </div>
              </li>
              <li aria-hidden="false">
               <div data-framer-name="Visual Electric">
                <a data-border="true" data-framer-name="Desktop" href="./stories/visual-electric/">
                 <div data-framer-name="Left">
                  <div data-framer-name="Pad Quote">
                   <div data-framer-name="Quote" data-framer-component-type="RichTextContainer">
                    <p>“Launching on Framer was seamless. Live in no time, no friction.”</p>
                   </div>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-name="User">
                    <div data-framer-name="Name">
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Colin Dunn</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Co-Founder at Visual Electric</p>
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="CTA 2025">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Read more</p>
                    </div>
                   </div>
                  </div>
                 </div>
                 <div data-framer-name="Right">
                  <div data-border="true" data-framer-name="Pause">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Visual Electric website" data-framer-original-sizes="calc(max(1160px / 2, 1px) - 120px)">
                   </div>
                  </div>
                 </div>
                </a>
               </div>
              </li>
              <li aria-hidden="false">
               <div data-framer-name="Biograph">
                <a data-border="true" data-framer-name="Desktop" href="./stories/biograph/">
                 <div data-framer-name="Left">
                  <div data-framer-name="Top">
                   <div data-framer-name="Logo">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Biograph logo" data-framer-original-sizes="60px">
                     </div>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="Pad Quote">
                   <div data-framer-name="Quote" data-framer-component-type="RichTextContainer">
                    <p>“Framer gave us full creative freedom. No code limits, no handoffs. We shipped an immersive brand site in days.”</p>
                   </div>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-name="User">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                    <div data-framer-name="Name">
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Adam Jiwa</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Partnerships at Metalab</p>
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="CTA 2025">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Read more</p>
                    </div>
                   </div>
                  </div>
                 </div>
                 <div data-framer-name="Right">
                  <div data-border="true" data-framer-name="Pause">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Biograph website" data-framer-original-sizes="calc(max(1160px / 2, 1px) - 120px)">
                   </div>
                  </div>
                  <div data-framer-name="BG Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Background" data-framer-original-sizes="max(1160px / 2, 1px)">
                   </div>
                  </div>
                 </div>
                </a>
               </div>
              </li>
              <li aria-hidden="false">
               <div data-framer-name="Cradle">
                <a data-border="true" data-framer-name="Desktop" href="./stories/cradle/">
                 <div data-framer-name="Left">
                  <div data-framer-name="Top">
                   <div data-framer-name="Logo">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Cradle logo" data-framer-original-sizes="60px">
                     </div>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="Pad Quote">
                   <div data-framer-name="Quote" data-framer-component-type="RichTextContainer">
                    <p>“With Framer, our designers can ship updates daily. No dev handoff. No staging hassle.”</p>
                   </div>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-name="User">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                    <div data-framer-name="Name">
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Jelle Prins</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Co-Founder at Cradle</p>
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="CTA 2025">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Read more</p>
                    </div>
                   </div>
                  </div>
                 </div>
                 <div data-framer-name="Right">
                  <div data-border="true" data-framer-name="Pause">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Cradle website" data-framer-original-sizes="calc(max(1160px / 2, 1px) - 120px)">
                   </div>
                  </div>
                  <div data-framer-name="BG Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Background" data-framer-original-sizes="max(1160px / 2, 1px)">
                   </div>
                  </div>
                 </div>
                </a>
               </div>
              </li>
              <li aria-hidden="false">
               <div data-framer-name="Miro">
                <a data-border="true" data-framer-name="Desktop" href="./stories/miro/">
                 <div data-framer-name="Left">
                  <div data-framer-name="Top">
                   <div data-framer-name="Logo">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Miro logo" data-framer-original-sizes="60px">
                     </div>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="Pad Quote">
                   <div data-framer-name="Quote" data-framer-component-type="RichTextContainer">
                    <p>“Framer allowed us to ship high-performing, beautifully designed pages at record speed, all while keeping design control in-house.”</p>
                   </div>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-name="User">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                    <div data-framer-name="Name">
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Radoslav Bali</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Design Lead at Miro</p>
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="CTA 2025">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Read more</p>
                    </div>
                   </div>
                  </div>
                 </div>
                 <div data-framer-name="Right">
                  <div data-border="true" data-framer-name="Pause">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Miro website" data-framer-original-sizes="calc(max(1160px / 2, 1px) - 120px)">
                   </div>
                  </div>
                  <div data-framer-name="BG Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Background" data-framer-original-sizes="max(1160px / 2, 1px)">
                   </div>
                  </div>
                 </div>
                </a>
               </div>
              </li>
             </ul>
             <fieldset aria-label="Slideshow pagination controls">
              <div>
               <button type="button" aria-label="Previous">
                <img alt="Back Arrow">
               </button>
               <button type="button" aria-label="Next">
                <img alt="Next Arrow">
               </button>
              </div>
              <div>
               <button aria-label="Scroll to page 1" type="button">
                <div>Perplexity</div>
               </button>
               <button aria-label="Scroll to page 2" type="button">
                <div>Visual Electric</div>
               </button>
               <button aria-label="Scroll to page 3" type="button">
                <div>Biograph</div>
               </button>
               <button aria-label="Scroll to page 4" type="button">
                <div>Cradle</div>
               </button>
               <button aria-label="Scroll to page 5" type="button">
                <div>Miro</div>
               </button>
              </div>
             </fieldset>
            </section>
           </div>
           <div data-framer-name="Slideshow Tablet" name="Slideshow Tablet">
            <section>
             <ul>
              <li aria-hidden="false">
               <div data-framer-name="Perplexity">
                <a data-border="true" data-framer-name="Tablet" href="./stories/perplexity/">
                 <div data-framer-name="Left">
                  <div data-framer-name="Top">
                   <div data-framer-name="Logo">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Perplexity logo" data-framer-original-sizes="60px">
                     </div>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="Pad Quote">
                   <div data-framer-name="Quote" data-framer-component-type="RichTextContainer">
                    <p>“Framer gives us everything we need to move fast. We don’t wait on dev. We don’t compromise on design.”</p>
                   </div>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-name="User">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                    <div data-framer-name="Name">
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Henry Modisett</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Head of Design at Perplexity</p>
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="CTA 2025">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Read more</p>
                    </div>
                   </div>
                  </div>
                 </div>
                 <div data-framer-name="Right">
                  <div data-border="true" data-framer-name="Pause">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Perplexity website" data-framer-original-sizes="calc(max(730px / 2, 1px) - 80px)">
                   </div>
                  </div>
                  <div data-framer-name="BG Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Background" data-framer-original-sizes="max(730px / 2, 1px)">
                   </div>
                  </div>
                 </div>
                </a>
               </div>
              </li>
              <li aria-hidden="false">
               <div data-framer-name="Visual Electric">
                <a data-border="true" data-framer-name="Tablet" href="./stories/visual-electric/">
                 <div data-framer-name="Left">
                  <div data-framer-name="Pad Quote">
                   <div data-framer-name="Quote" data-framer-component-type="RichTextContainer">
                    <p>“Launching on Framer was seamless. Live in no time, no friction.”</p>
                   </div>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-name="User">
                    <div data-framer-name="Name">
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Colin Dunn</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Co-Founder at Visual Electric</p>
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="CTA 2025">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Read more</p>
                    </div>
                   </div>
                  </div>
                 </div>
                 <div data-framer-name="Right">
                  <div data-border="true" data-framer-name="Pause">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Visual Electric website" data-framer-original-sizes="calc(max(730px / 2, 1px) - 80px)">
                   </div>
                  </div>
                 </div>
                </a>
               </div>
              </li>
              <li aria-hidden="false">
               <div data-framer-name="Biograph">
                <a data-border="true" data-framer-name="Tablet" href="./stories/biograph/">
                 <div data-framer-name="Left">
                  <div data-framer-name="Top">
                   <div data-framer-name="Logo">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Biograph logo" data-framer-original-sizes="60px">
                     </div>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="Pad Quote">
                   <div data-framer-name="Quote" data-framer-component-type="RichTextContainer">
                    <p>“Framer gave us full creative freedom. No code limits, no handoffs. We shipped an immersive brand site in days.”</p>
                   </div>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-name="User">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                    <div data-framer-name="Name">
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Adam Jiwa</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Partnerships at Metalab</p>
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="CTA 2025">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Read more</p>
                    </div>
                   </div>
                  </div>
                 </div>
                 <div data-framer-name="Right">
                  <div data-border="true" data-framer-name="Pause">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Biograph website" data-framer-original-sizes="calc(max(730px / 2, 1px) - 80px)">
                   </div>
                  </div>
                  <div data-framer-name="BG Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Background" data-framer-original-sizes="max(730px / 2, 1px)">
                   </div>
                  </div>
                 </div>
                </a>
               </div>
              </li>
              <li aria-hidden="false">
               <div data-framer-name="Cradle">
                <a data-border="true" data-framer-name="Tablet" href="./stories/cradle/">
                 <div data-framer-name="Left">
                  <div data-framer-name="Top">
                   <div data-framer-name="Logo">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Cradle logo" data-framer-original-sizes="60px">
                     </div>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="Pad Quote">
                   <div data-framer-name="Quote" data-framer-component-type="RichTextContainer">
                    <p>“With Framer, our designers can ship updates daily. No dev handoff. No staging hassle.”</p>
                   </div>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-name="User">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                    <div data-framer-name="Name">
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Jelle Prins</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Co-Founder at Cradle</p>
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="CTA 2025">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Read more</p>
                    </div>
                   </div>
                  </div>
                 </div>
                 <div data-framer-name="Right">
                  <div data-border="true" data-framer-name="Pause">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Cradle website" data-framer-original-sizes="calc(max(730px / 2, 1px) - 80px)">
                   </div>
                  </div>
                  <div data-framer-name="BG Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Background" data-framer-original-sizes="max(730px / 2, 1px)">
                   </div>
                  </div>
                 </div>
                </a>
               </div>
              </li>
              <li aria-hidden="false">
               <div data-framer-name="Miro">
                <a data-border="true" data-framer-name="Tablet" href="./stories/miro/">
                 <div data-framer-name="Left">
                  <div data-framer-name="Top">
                   <div data-framer-name="Logo">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Miro logo" data-framer-original-sizes="60px">
                     </div>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="Pad Quote">
                   <div data-framer-name="Quote" data-framer-component-type="RichTextContainer">
                    <p>“Framer allowed us to ship high-performing, beautifully designed pages at record speed, all while keeping design control in-house.”</p>
                   </div>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-name="User">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                    <div data-framer-name="Name">
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Radoslav Bali</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Design Lead at Miro</p>
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="CTA 2025">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Read more</p>
                    </div>
                   </div>
                  </div>
                 </div>
                 <div data-framer-name="Right">
                  <div data-border="true" data-framer-name="Pause">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Miro website" data-framer-original-sizes="calc(max(730px / 2, 1px) - 80px)">
                   </div>
                  </div>
                  <div data-framer-name="BG Image">
                   <div data-framer-background-image-wrapper="true">
                    <img alt="Background" data-framer-original-sizes="max(730px / 2, 1px)">
                   </div>
                  </div>
                 </div>
                </a>
               </div>
              </li>
             </ul>
             <fieldset aria-label="Slideshow pagination controls">
              <div>
               <button type="button" aria-label="Previous">
                <img alt="Back Arrow">
               </button>
               <button type="button" aria-label="Next">
                <img alt="Next Arrow">
               </button>
              </div>
              <div>
               <button aria-label="Scroll to page 1" type="button">
                <div>Perplexity</div>
               </button>
               <button aria-label="Scroll to page 2" type="button">
                <div>Visual Electric</div>
               </button>
               <button aria-label="Scroll to page 3" type="button">
                <div>Biograph</div>
               </button>
               <button aria-label="Scroll to page 4" type="button">
                <div>Cradle</div>
               </button>
               <button aria-label="Scroll to page 5" type="button">
                <div>Miro</div>
               </button>
              </div>
             </fieldset>
            </section>
           </div>
           <div data-framer-name="Slideshow Phone" name="Slideshow Phone">
            <section>
             <ul>
              <li aria-hidden="false">
               <div data-framer-name="Perplexity">
                <a data-border="true" data-framer-name="Phone" href="./stories/perplexity/">
                 <div data-framer-name="Left">
                  <div data-framer-name="Top">
                   <div data-framer-name="Logo">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Perplexity logo" data-framer-original-sizes="60px">
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="CTA 2025">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Read more</p>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="Pad Quote">
                   <div data-framer-name="Quote" data-framer-component-type="RichTextContainer">
                    <p>“Framer gives us everything we need to move fast. We don’t wait on dev. We don’t compromise on design.”</p>
                   </div>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-name="User">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                    <div data-framer-name="Name">
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Henry Modisett</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Head of Design at Perplexity</p>
                     </div>
                    </div>
                   </div>
                  </div>
                 </div>
                </a>
               </div>
              </li>
              <li aria-hidden="false">
               <div data-framer-name="Visual Electric">
                <a data-border="true" data-framer-name="Phone" href="./stories/visual-electric/">
                 <div data-framer-name="Left">
                  <div data-framer-name="Top">
                   <div data-framer-name="CTA 2025">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Read more</p>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="Pad Quote">
                   <div data-framer-name="Quote" data-framer-component-type="RichTextContainer">
                    <p>“Launching on Framer was seamless. Live in no time, no friction.”</p>
                   </div>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-name="User">
                    <div data-framer-name="Name">
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Colin Dunn</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Co-Founder at Visual Electric</p>
                     </div>
                    </div>
                   </div>
                  </div>
                 </div>
                </a>
               </div>
              </li>
              <li aria-hidden="false">
               <div data-framer-name="Biograph">
                <a data-border="true" data-framer-name="Phone" href="./stories/biograph/">
                 <div data-framer-name="Left">
                  <div data-framer-name="Top">
                   <div data-framer-name="Logo">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Biograph logo" data-framer-original-sizes="60px">
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="CTA 2025">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Read more</p>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="Pad Quote">
                   <div data-framer-name="Quote" data-framer-component-type="RichTextContainer">
                    <p>“Framer gave us full creative freedom. No code limits, no handoffs. We shipped an immersive brand site in days.”</p>
                   </div>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-name="User">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                    <div data-framer-name="Name">
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Adam Jiwa</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Partnerships at Metalab</p>
                     </div>
                    </div>
                   </div>
                  </div>
                 </div>
                </a>
               </div>
              </li>
              <li aria-hidden="false">
               <div data-framer-name="Cradle">
                <a data-border="true" data-framer-name="Phone" href="./stories/cradle/">
                 <div data-framer-name="Left">
                  <div data-framer-name="Top">
                   <div data-framer-name="Logo">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Cradle logo" data-framer-original-sizes="60px">
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="CTA 2025">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Read more</p>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="Pad Quote">
                   <div data-framer-name="Quote" data-framer-component-type="RichTextContainer">
                    <p>“With Framer, our designers can ship updates daily. No dev handoff. No staging hassle.”</p>
                   </div>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-name="User">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                    <div data-framer-name="Name">
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Jelle Prins</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Co-Founder at Cradle</p>
                     </div>
                    </div>
                   </div>
                  </div>
                 </div>
                </a>
               </div>
              </li>
              <li aria-hidden="false">
               <div data-framer-name="Miro">
                <a data-border="true" data-framer-name="Phone" href="./stories/miro/">
                 <div data-framer-name="Left">
                  <div data-framer-name="Top">
                   <div data-framer-name="Logo">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Miro logo" data-framer-original-sizes="60px">
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="CTA 2025">
                    <div data-framer-component-type="RichTextContainer">
                     <p>Read more</p>
                    </div>
                   </div>
                  </div>
                  <div data-framer-name="Pad Quote">
                   <div data-framer-name="Quote" data-framer-component-type="RichTextContainer">
                    <p>“Framer allowed us to ship high-performing, beautifully designed pages at record speed, all while keeping design control in-house.”</p>
                   </div>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-name="User">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                    <div data-framer-name="Name">
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Radoslav Bali</p>
                     </div>
                     <div data-framer-component-type="RichTextContainer">
                      <p data-styles-preset="XHuCPIQKc">Design Lead at Miro</p>
                     </div>
                    </div>
                   </div>
                  </div>
                 </div>
                </a>
               </div>
              </li>
             </ul>
             <fieldset aria-label="Slideshow pagination controls">
              <div>
               <button type="button" aria-label="Previous">
                <img alt="Back Arrow">
               </button>
               <button type="button" aria-label="Next">
                <img alt="Next Arrow">
               </button>
              </div>
              <div>
               <button aria-label="Scroll to page 1" type="button"></button>
               <button aria-label="Scroll to page 2" type="button"></button>
               <button aria-label="Scroll to page 3" type="button"></button>
               <button aria-label="Scroll to page 4" type="button"></button>
               <button aria-label="Scroll to page 5" type="button"></button>
              </div>
             </fieldset>
            </section>
           </div>
          </div>
         </div>
         <section data-framer-name="Experts">
          <header data-framer-name="Header">
           <div data-framer-component-type="RichTextContainer">
            <h2 data-styles-preset="Y4paqDh7P">Get pro help from handpicked experts</h2>
           </div>
           <div data-framer-name="Buttons">
            <a data-framer-name="Regular" data-highlight="true" data-reset="button" href="./match/">
             <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
              <p>Get matched</p>
             </div>
            </a>
            <a data-framer-name="Phone" data-highlight="true" data-reset="button" href="./match/">
             <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
              <p>Get matched</p>
             </div>
            </a>
            <a data-framer-name="Regular" data-highlight="true" data-reset="button" href="./match/">
             <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
              <p>Get matched</p>
             </div>
            </a>
            <a data-framer-name="Regular" data-highlight="true" data-reset="button" href="https://www.framer.com/experts/">
             <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
              <p>Find an Expert</p>
             </div>
            </a>
            <a data-framer-name="Phone" data-highlight="true" data-reset="button" href="https://www.framer.com/experts/">
             <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
              <p>Find an Expert</p>
             </div>
            </a>
            <a data-framer-name="Regular" data-highlight="true" data-reset="button" href="https://www.framer.com/experts/">
             <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
              <p>Find an Expert</p>
             </div>
            </a>
           </div>
          </header>
          <div data-framer-name="Visual">
           <div data-framer-name="Desktop Slideshow" name="Desktop Slideshow">
            <section>
             <ul>
              <li aria-hidden="false">
               <div data-framer-name="Experts Desktop 1">
                <div data-framer-name="Trueform" name="Trueform">
                 <a name="Trueform" data-framer-name="Expert" href="https://www.framer.com/@trueform/">
                  <div data-border="true" data-framer-name="Visual">
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-component-type="RichTextContainer">
                     <p>View Expert</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="User">
                   <div data-framer-name="Avatar">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="Name">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Trueform</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Switzerland</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Alex Aperios" name="Alex Aperios">
                 <a name="Alex Aperios" data-framer-name="Expert" href="https://www.framer.com/@alex-aperios/">
                  <div data-border="true" data-framer-name="Visual">
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-component-type="RichTextContainer">
                     <p>View Expert</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="User">
                   <div data-framer-name="Name">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Alex Aperios</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">United Kingdom</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Analogue Agency" name="Analogue Agency">
                 <a name="Analogue Agency" data-framer-name="Expert" href="https://www.framer.com/@analogueagency/">
                  <div data-border="true" data-framer-name="Visual">
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-component-type="RichTextContainer">
                     <p>View Expert</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="User">
                   <div data-framer-name="Avatar">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="Name">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Analogue Agency</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Netherlands</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Fabian Albert" name="Fabian Albert">
                 <a name="Fabian Albert" data-framer-name="Expert" href="https://www.framer.com/@fabian-albert/">
                  <div data-border="true" data-framer-name="Visual">
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-component-type="RichTextContainer">
                     <p>View Expert</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="User">
                   <div data-framer-name="Avatar">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="Name">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Fabian Albert</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">United States</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
               </div>
              </li>
              <li aria-hidden="false">
               <div data-framer-name="Experts Desktop 2">
                <div data-framer-name="Allsite Studio" name="Allsite Studio">
                 <a name="Allsite Studio" data-framer-name="Expert" href="https://www.framer.com/@ben-libor/">
                  <div data-border="true" data-framer-name="Visual">
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-component-type="RichTextContainer">
                     <p>View Expert</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="User">
                   <div data-framer-name="Avatar">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="Name">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Allsite Studio</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Germany</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Aerolab" name="Aerolab">
                 <a name="Aerolab" data-framer-name="Expert" href="https://www.framer.com/@aerolab/">
                  <div data-border="true" data-framer-name="Visual">
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-component-type="RichTextContainer">
                     <p>View Expert</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="User">
                   <div data-framer-name="Avatar">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="Name">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Aerolab</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">United States</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Adriano Reis" name="Adriano Reis">
                 <a name="Adriano Reis" data-framer-name="Expert" href="https://www.framer.com/@adrianoreis/">
                  <div data-border="true" data-framer-name="Visual">
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-component-type="RichTextContainer">
                     <p>View Expert</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="User">
                   <div data-framer-name="Avatar">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="Name">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Adriano Reis</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">United States</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Deserve Studio" name="Deserve Studio">
                 <a name="Deserve Studio" data-framer-name="Expert" href="https://www.framer.com/@deservestudio/">
                  <div data-border="true" data-framer-name="Visual">
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-component-type="RichTextContainer">
                     <p>View Expert</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="User">
                   <div data-framer-name="Avatar">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="Name">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Deserve Studio</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">United States</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
               </div>
              </li>
             </ul>
             <fieldset aria-label="Slideshow pagination controls">
              <div>
               <button type="button" aria-label="Previous">
                <img alt="Back Arrow">
               </button>
               <button type="button" aria-label="Next">
                <img alt="Next Arrow">
               </button>
              </div>
              <div>
               <button aria-label="Scroll to page 1" type="button"></button>
               <button aria-label="Scroll to page 2" type="button"></button>
              </div>
             </fieldset>
            </section>
           </div>
           <div data-framer-name="Tablet Slideshow" name="Tablet Slideshow">
            <section>
             <ul>
              <li aria-hidden="false">
               <div data-framer-name="Experts Tablet 1">
                <div data-framer-name="Trueform" name="Trueform">
                 <a name="Trueform" data-framer-name="Expert" href="https://www.framer.com/@trueform/">
                  <div data-border="true" data-framer-name="Visual">
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-component-type="RichTextContainer">
                     <p>View Expert</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="User">
                   <div data-framer-name="Avatar">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="Name">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Trueform</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Switzerland</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Alex Aperios" name="Alex Aperios">
                 <a name="Alex Aperios" data-framer-name="Expert" href="https://www.framer.com/@alex-aperios/">
                  <div data-border="true" data-framer-name="Visual">
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-component-type="RichTextContainer">
                     <p>View Expert</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="User">
                   <div data-framer-name="Name">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Alex Aperios</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">United Kingdom</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Analogue Agency" name="Analogue Agency">
                 <a name="Analogue Agency" data-framer-name="Expert" href="https://www.framer.com/@analogueagency/">
                  <div data-border="true" data-framer-name="Visual">
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-component-type="RichTextContainer">
                     <p>View Expert</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="User">
                   <div data-framer-name="Avatar">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="Name">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Analogue Agency</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Netherlands</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Fabian Albert" name="Fabian Albert">
                 <a name="Fabian Albert" data-framer-name="Expert" href="https://www.framer.com/@fabian-albert/">
                  <div data-border="true" data-framer-name="Visual">
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-component-type="RichTextContainer">
                     <p>View Expert</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="User">
                   <div data-framer-name="Avatar">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="Name">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Fabian Albert</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">United States</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
               </div>
              </li>
              <li aria-hidden="false">
               <div data-framer-name="Experts Tablet 2">
                <div data-framer-name="Allsite Studio" name="Allsite Studio">
                 <a name="Allsite Studio" data-framer-name="Expert" href="https://www.framer.com/@ben-libor/">
                  <div data-border="true" data-framer-name="Visual">
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-component-type="RichTextContainer">
                     <p>View Expert</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="User">
                   <div data-framer-name="Avatar">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="Name">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Allsite Studio</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Germany</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Aerolab" name="Aerolab">
                 <a name="Aerolab" data-framer-name="Expert" href="https://www.framer.com/@aerolab/">
                  <div data-border="true" data-framer-name="Visual">
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-component-type="RichTextContainer">
                     <p>View Expert</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="User">
                   <div data-framer-name="Avatar">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="Name">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Aerolab</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">United States</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Adriano Reis" name="Adriano Reis">
                 <a name="Adriano Reis" data-framer-name="Expert" href="https://www.framer.com/@adrianoreis/">
                  <div data-border="true" data-framer-name="Visual">
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-component-type="RichTextContainer">
                     <p>View Expert</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="User">
                   <div data-framer-name="Avatar">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="Name">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Adriano Reis</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">United States</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Deserve Studio" name="Deserve Studio">
                 <a name="Deserve Studio" data-framer-name="Expert" href="https://www.framer.com/@deservestudio/">
                  <div data-border="true" data-framer-name="Visual">
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-component-type="RichTextContainer">
                     <p>View Expert</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="User">
                   <div data-framer-name="Avatar">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Avatar">
                     </div>
                    </div>
                   </div>
                   <div data-framer-name="Name">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Deserve Studio</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">United States</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
               </div>
              </li>
             </ul>
             <fieldset aria-label="Slideshow pagination controls">
              <div>
               <button type="button" aria-label="Previous">
                <img alt="Back Arrow">
               </button>
               <button type="button" aria-label="Next">
                <img alt="Next Arrow">
               </button>
              </div>
              <div>
               <button aria-label="Scroll to page 1" type="button"></button>
               <button aria-label="Scroll to page 2" type="button"></button>
              </div>
             </fieldset>
            </section>
           </div>
           <div data-framer-name="Phone Slideshow" name="Phone Slideshow">
            <section>
             <ul>
              <li aria-hidden="false">
               <div data-framer-name="Experts Phone 1">
                <div data-framer-name="Trueform" name="Trueform">
                 <a name="Trueform" data-framer-name="Expert" href="https://www.framer.com/@trueform/">
                  <div data-border="true" data-framer-name="Visual">
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-component-type="RichTextContainer">
                     <p>View Expert</p>
                    </div>
                   </button>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Alex Aperios" name="Alex Aperios">
                 <a name="Alex Aperios" data-framer-name="Expert" href="https://www.framer.com/@alex-aperios/">
                  <div data-border="true" data-framer-name="Visual">
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-component-type="RichTextContainer">
                     <p>View Expert</p>
                    </div>
                   </button>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Analogue Agency" name="Analogue Agency">
                 <a name="Analogue Agency" data-framer-name="Expert" href="https://www.framer.com/@analogueagency/">
                  <div data-border="true" data-framer-name="Visual">
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-component-type="RichTextContainer">
                     <p>View Expert</p>
                    </div>
                   </button>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Fabian Albert" name="Fabian Albert">
                 <a name="Fabian Albert" data-framer-name="Expert" href="https://www.framer.com/@fabian-albert/">
                  <div data-border="true" data-framer-name="Visual">
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-component-type="RichTextContainer">
                     <p>View Expert</p>
                    </div>
                   </button>
                  </div>
                 </a>
                </div>
               </div>
              </li>
              <li aria-hidden="false">
               <div data-framer-name="Experts Phone 2">
                <div data-framer-name="Allsite Studio" name="Allsite Studio">
                 <a name="Allsite Studio" data-framer-name="Expert" href="https://www.framer.com/@ben-libor/">
                  <div data-border="true" data-framer-name="Visual">
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-component-type="RichTextContainer">
                     <p>View Expert</p>
                    </div>
                   </button>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Aerolab" name="Aerolab">
                 <a name="Aerolab" data-framer-name="Expert" href="https://www.framer.com/@aerolab/">
                  <div data-border="true" data-framer-name="Visual">
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-component-type="RichTextContainer">
                     <p>View Expert</p>
                    </div>
                   </button>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Adriano Reis" name="Adriano Reis">
                 <a name="Adriano Reis" data-framer-name="Expert" href="https://www.framer.com/@adrianoreis/">
                  <div data-border="true" data-framer-name="Visual">
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-component-type="RichTextContainer">
                     <p>View Expert</p>
                    </div>
                   </button>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Deserve Studio" name="Deserve Studio">
                 <a name="Deserve Studio" data-framer-name="Expert" href="https://www.framer.com/@deservestudio/">
                  <div data-border="true" data-framer-name="Visual">
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-component-type="RichTextContainer">
                     <p>View Expert</p>
                    </div>
                   </button>
                  </div>
                 </a>
                </div>
               </div>
              </li>
             </ul>
             <fieldset aria-label="Slideshow pagination controls">
              <div>
               <button type="button" aria-label="Previous">
                <img alt="Back Arrow">
               </button>
               <button type="button" aria-label="Next">
                <img alt="Next Arrow">
               </button>
              </div>
              <div>
               <button aria-label="Scroll to page 1" type="button"></button>
               <button aria-label="Scroll to page 2" type="button"></button>
              </div>
             </fieldset>
            </section>
           </div>
          </div>
         </section>
         <section data-framer-name="Community">
          <header data-framer-name="Header">
           <div data-framer-component-type="RichTextContainer">
            <h2 data-styles-preset="Y4paqDh7P">Launch faster with community resources</h2>
           </div>
           <div data-framer-name="Buttons">
            <a data-framer-name="Regular" data-highlight="true" data-reset="button" href="https://www.framer.com/marketplace/templates/">
             <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
              <p>Templates</p>
             </div>
            </a>
            <a data-framer-name="Phone" data-highlight="true" data-reset="button" href="https://www.framer.com/marketplace/templates/">
             <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
              <p>Templates</p>
             </div>
            </a>
            <a data-framer-name="Regular" data-highlight="true" data-reset="button" href="https://www.framer.com/marketplace/templates/">
             <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
              <p>Templates</p>
             </div>
            </a>
            <a data-framer-name="Regular" data-highlight="true" data-reset="button" href="https://www.framer.com/marketplace/plugins/">
             <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
              <p>Plugins</p>
             </div>
            </a>
            <a data-framer-name="Phone" data-highlight="true" data-reset="button" href="https://www.framer.com/marketplace/plugins/">
             <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
              <p>Plugins</p>
             </div>
            </a>
            <a data-framer-name="Regular" data-highlight="true" data-reset="button" href="https://www.framer.com/marketplace/plugins/">
             <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
              <p>Plugins</p>
             </div>
            </a>
            <a data-framer-name="Regular" data-highlight="true" data-reset="button" href="https://www.framer.com/marketplace/components/">
             <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
              <p>Components</p>
             </div>
            </a>
            <a data-framer-name="Phone" data-highlight="true" data-reset="button" href="https://www.framer.com/marketplace/components/">
             <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
              <p>Components</p>
             </div>
            </a>
            <a data-framer-name="Regular" data-highlight="true" data-reset="button" href="https://www.framer.com/marketplace/components/">
             <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
              <p>Components</p>
             </div>
            </a>
           </div>
          </header>
          <div data-framer-name="Visual">
           <div data-framer-name="Desktop">
            <div data-framer-name="Market Desktop 1">
             <ul role="group">
              <li aria-hidden="false">
               <div>
                <a data-framer-name="Pause" href="https://www.framer.com/marketplace/components/image-slider/">
                 <div data-border="true" data-framer-name="Visual">
                  <div data-framer-name="Wrapper">
                   <div data-framer-name="Hover">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Framer marketplace item" data-framer-original-sizes="360px">
                    </div>
                   </div>
                  </div>
                  <button data-framer-name="Button 2025" data-reset="button">
                   <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                    <p>View Component</p>
                   </div>
                  </button>
                 </div>
                 <div data-framer-name="Text">
                  <div data-framer-component-type="RichTextContainer">
                   <p data-styles-preset="XHuCPIQKc">Image Slider</p>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Component</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Before and after images</p>
                   </div>
                  </div>
                 </div>
                </a>
                <a data-framer-name="Pause" href="https://www.framer.com/marketplace/templates/milo/">
                 <div data-border="true" data-framer-name="Visual">
                  <div data-framer-name="Wrapper">
                   <div data-framer-name="Image">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Framer marketplace item" data-framer-original-sizes="360px">
                    </div>
                   </div>
                   <div data-framer-name="Hover">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Framer marketplace item" data-framer-original-sizes="360px">
                    </div>
                   </div>
                  </div>
                  <button data-framer-name="Button 2025" data-reset="button">
                   <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                    <p>View Template</p>
                   </div>
                  </button>
                 </div>
                 <div data-framer-name="Text">
                  <div data-framer-component-type="RichTextContainer">
                   <p data-styles-preset="XHuCPIQKc">Milo</p>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Template</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Furniture shop website</p>
                   </div>
                  </div>
                 </div>
                </a>
                <a data-framer-name="Pause" href="https://www.framer.com/marketplace/plugins/notion/">
                 <div data-border="true" data-framer-name="Visual">
                  <div data-framer-name="Wrapper">
                   <div data-framer-name="Image">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Framer marketplace item" data-framer-original-sizes="360px">
                    </div>
                   </div>
                   <div data-framer-name="Hover">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Framer marketplace item" data-framer-original-sizes="360px">
                    </div>
                   </div>
                  </div>
                  <button data-framer-name="Button 2025" data-reset="button">
                   <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                    <p>View Plugin</p>
                   </div>
                  </button>
                 </div>
                 <div data-framer-name="Text">
                  <div data-framer-component-type="RichTextContainer">
                   <p data-styles-preset="XHuCPIQKc">Notion</p>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Plugin</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Sync with Notion</p>
                   </div>
                  </div>
                 </div>
                </a>
                <a data-framer-name="Pause" href="https://www.framer.com/marketplace/components/hover-image-zoom/">
                 <div data-border="true" data-framer-name="Visual">
                  <div data-framer-name="Wrapper">
                   <div data-framer-name="Hover">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Framer marketplace item" data-framer-original-sizes="360px">
                    </div>
                   </div>
                  </div>
                  <button data-framer-name="Button 2025" data-reset="button">
                   <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                    <p>View Component</p>
                   </div>
                  </button>
                 </div>
                 <div data-framer-name="Text">
                  <div data-framer-component-type="RichTextContainer">
                   <p data-styles-preset="XHuCPIQKc">Hover Zoom</p>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Component</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Zoom and pan on hover</p>
                   </div>
                  </div>
                 </div>
                </a>
                <a data-framer-name="Pause" href="https://www.framer.com/marketplace/templates/archer/">
                 <div data-border="true" data-framer-name="Visual">
                  <div data-framer-name="Wrapper">
                   <div data-framer-name="Image">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Framer marketplace item" data-framer-original-sizes="360px">
                    </div>
                   </div>
                   <div data-framer-name="Hover">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Framer marketplace item" data-framer-original-sizes="360px">
                    </div>
                   </div>
                  </div>
                  <button data-framer-name="Button 2025" data-reset="button">
                   <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                    <p>View Template</p>
                   </div>
                  </button>
                 </div>
                 <div data-framer-name="Text">
                  <div data-framer-component-type="RichTextContainer">
                   <p data-styles-preset="XHuCPIQKc">Archer</p>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Template</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Creative portfolio</p>
                   </div>
                  </div>
                 </div>
                </a>
                <a data-framer-name="Pause" href="https://www.framer.com/marketplace/plugins/workshop/">
                 <div data-border="true" data-framer-name="Visual">
                  <div data-framer-name="Wrapper">
                   <div data-framer-name="Image">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Framer marketplace item" data-framer-original-sizes="360px">
                    </div>
                   </div>
                   <div data-framer-name="Hover">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Framer marketplace item" data-framer-original-sizes="360px">
                    </div>
                   </div>
                  </div>
                  <button data-framer-name="Button 2025" data-reset="button">
                   <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                    <p>View Plugin</p>
                   </div>
                  </button>
                 </div>
                 <div data-framer-name="Text">
                  <div data-framer-component-type="RichTextContainer">
                   <p data-styles-preset="XHuCPIQKc">Workshop</p>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Plugin</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Turn ideas into components</p>
                   </div>
                  </div>
                 </div>
                </a>
               </div>
              </li>
             </ul>
            </div>
            <div data-framer-name="Market Desktop 2">
             <ul role="group">
              <li aria-hidden="false">
               <div>
                <a data-framer-name="Pause" href="https://www.framer.com/marketplace/components/digital-rotary-radio/">
                 <div data-border="true" data-framer-name="Visual">
                  <div data-framer-name="Wrapper">
                   <div data-framer-name="Hover">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Framer marketplace item" data-framer-original-sizes="360px">
                    </div>
                   </div>
                  </div>
                  <button data-framer-name="Button 2025" data-reset="button">
                   <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                    <p>View Component</p>
                   </div>
                  </button>
                 </div>
                 <div data-framer-name="Text">
                  <div data-framer-component-type="RichTextContainer">
                   <p data-styles-preset="XHuCPIQKc">Digital Rotary Radio</p>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Component</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Fully functional radio</p>
                   </div>
                  </div>
                 </div>
                </a>
                <a data-framer-name="Pause" href="https://www.framer.com/marketplace/templates/apex-films/">
                 <div data-border="true" data-framer-name="Visual">
                  <div data-framer-name="Wrapper">
                   <div data-framer-name="Image">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Framer marketplace item" data-framer-original-sizes="360px">
                    </div>
                   </div>
                   <div data-framer-name="Hover">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Framer marketplace item" data-framer-original-sizes="360px">
                    </div>
                   </div>
                  </div>
                  <button data-framer-name="Button 2025" data-reset="button">
                   <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                    <p>View Template</p>
                   </div>
                  </button>
                 </div>
                 <div data-framer-name="Text">
                  <div data-framer-component-type="RichTextContainer">
                   <p data-styles-preset="XHuCPIQKc">Apex Films</p>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Template</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Multimedia portfolio</p>
                   </div>
                  </div>
                 </div>
                </a>
                <a data-framer-name="Pause" href="https://www.framer.com/marketplace/components/flipcard-component/">
                 <div data-border="true" data-framer-name="Visual">
                  <div data-framer-name="Wrapper">
                   <div data-framer-name="Hover">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Framer marketplace item" data-framer-original-sizes="360px">
                    </div>
                   </div>
                  </div>
                  <button data-framer-name="Button 2025" data-reset="button">
                   <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                    <p>View Component</p>
                   </div>
                  </button>
                 </div>
                 <div data-framer-name="Text">
                  <div data-framer-component-type="RichTextContainer">
                   <p data-styles-preset="XHuCPIQKc">Flip Card</p>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Component</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Drag to flip cards</p>
                   </div>
                  </div>
                 </div>
                </a>
                <a data-framer-name="Pause" href="https://www.framer.com/marketplace/components/animated-gradient/">
                 <div data-border="true" data-framer-name="Visual">
                  <div data-framer-name="Wrapper">
                   <div data-framer-name="Hover">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Framer marketplace item" data-framer-original-sizes="360px">
                    </div>
                   </div>
                  </div>
                  <button data-framer-name="Button 2025" data-reset="button">
                   <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                    <p>View Component</p>
                   </div>
                  </button>
                 </div>
                 <div data-framer-name="Text">
                  <div data-framer-component-type="RichTextContainer">
                   <p data-styles-preset="XHuCPIQKc">Animated Gradients</p>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Component</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Image reveal effect</p>
                   </div>
                  </div>
                 </div>
                </a>
                <a data-framer-name="Pause" href="https://www.framer.com/marketplace/plugins/json-sync/">
                 <div data-border="true" data-framer-name="Visual">
                  <div data-framer-name="Wrapper">
                   <div data-framer-name="Image">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Framer marketplace item" data-framer-original-sizes="360px">
                    </div>
                   </div>
                   <div data-framer-name="Hover">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Framer marketplace item" data-framer-original-sizes="360px">
                    </div>
                   </div>
                  </div>
                  <button data-framer-name="Button 2025" data-reset="button">
                   <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                    <p>View Plugin</p>
                   </div>
                  </button>
                 </div>
                 <div data-framer-name="Text">
                  <div data-framer-component-type="RichTextContainer">
                   <p data-styles-preset="XHuCPIQKc">JSON Sync</p>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Plugin</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Import &amp; export CMS with JSON</p>
                   </div>
                  </div>
                 </div>
                </a>
                <a data-framer-name="Pause" href="https://www.framer.com/marketplace/templates/baseform/">
                 <div data-border="true" data-framer-name="Visual">
                  <div data-framer-name="Wrapper">
                   <div data-framer-name="Image">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Framer marketplace item" data-framer-original-sizes="360px">
                    </div>
                   </div>
                   <div data-framer-name="Hover">
                    <div data-framer-background-image-wrapper="true">
                     <img alt="Framer marketplace item" data-framer-original-sizes="360px">
                    </div>
                   </div>
                  </div>
                  <button data-framer-name="Button 2025" data-reset="button">
                   <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                    <p>View Template</p>
                   </div>
                  </button>
                 </div>
                 <div data-framer-name="Text">
                  <div data-framer-component-type="RichTextContainer">
                   <p data-styles-preset="XHuCPIQKc">Baseform</p>
                  </div>
                  <div data-framer-name="Bottom">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Template</p>
                   </div>
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Modern design portfolio</p>
                   </div>
                  </div>
                 </div>
                </a>
               </div>
              </li>
             </ul>
            </div>
           </div>
           <div data-framer-name="Phone">
            <div data-framer-name="Market Phone 1">
             <ul role="group">
              <li aria-hidden="false">
               <div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/components/image-slider/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Component</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Image Slider</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Component</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Before and after images</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/components/image-slider/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Component</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Image Slider</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Component</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Before and after images</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/templates/milo/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Template</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Milo</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Template</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Furniture shop website</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/templates/milo/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Template</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Milo</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Template</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Furniture shop website</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/plugins/notion/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Plugin</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Notion</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Plugin</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Sync with Notion</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/plugins/notion/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Plugin</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Notion</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Plugin</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Sync with Notion</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/components/hover-image-zoom/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Component</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Hover Zoom</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Component</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Zoom and pan on hover</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/components/hover-image-zoom/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Component</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Hover Zoom</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Component</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Zoom and pan on hover</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/templates/archer/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Template</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Archer</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Template</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Creative portfolio</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/templates/archer/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Template</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Archer</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Template</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Creative portfolio</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/plugins/workshop/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Plugin</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Workshop</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Plugin</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Turn ideas into components</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/plugins/workshop/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Plugin</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Workshop</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Plugin</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Turn ideas into components</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/components/digital-rotary-radio/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Component</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Digital Rotary Radio</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Component</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Fully functional radio</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/components/digital-rotary-radio/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Component</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Digital Rotary Radio</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Component</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Fully functional radio</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
               </div>
              </li>
              <li aria-hidden="false">
               <div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/components/image-slider/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Component</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Image Slider</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Component</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Before and after images</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/templates/milo/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Template</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Milo</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Template</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Furniture shop website</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/plugins/notion/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Plugin</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Notion</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Plugin</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Sync with Notion</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/components/hover-image-zoom/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Component</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Hover Zoom</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Component</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Zoom and pan on hover</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/templates/archer/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Template</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Archer</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Template</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Creative portfolio</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/plugins/workshop/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Plugin</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Workshop</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Plugin</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Turn ideas into components</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/components/digital-rotary-radio/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Component</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Digital Rotary Radio</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Component</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Fully functional radio</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
               </div>
              </li>
             </ul>
            </div>
            <div data-framer-name="Market Phone 2">
             <ul role="group">
              <li aria-hidden="false">
               <div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/templates/apex-films/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Template</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Apex Films</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Template</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Multimedia portfolio</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/templates/apex-films/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Template</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Apex Films</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Template</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Multimedia portfolio</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/components/flipcard-component/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Component</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Flip Card</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Component</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Drag to flip cards</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/components/flipcard-component/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Component</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Flip Card</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Component</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Drag to flip cards</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/components/animated-gradient/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Component</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Animated Gradients</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Component</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Image reveal effect</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/components/animated-gradient/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Component</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Animated Gradients</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Component</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Image reveal effect</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/plugins/json-sync/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Plugin</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">JSON Sync</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Plugin</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Import &amp; export CMS with JSON</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/plugins/json-sync/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Plugin</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">JSON Sync</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Plugin</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Import &amp; export CMS with JSON</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/templates/baseform/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Template</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Baseform</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Template</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Modern design portfolio</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/templates/baseform/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Template</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Baseform</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Template</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Modern design portfolio</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/plugins/asset-manager/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Plugin</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Asset Manager</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Plugin</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Manage your site's assets</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/plugins/asset-manager/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Plugin</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Asset Manager</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Plugin</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Manage your site's assets</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/components/videoplayer/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Component</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Video Player</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Component</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Beautiful video player</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/components/videoplayer/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Component</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Video Player</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Component</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Beautiful video player</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
               </div>
              </li>
              <li aria-hidden="false">
               <div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/templates/apex-films/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Template</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Apex Films</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Template</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Multimedia portfolio</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/components/flipcard-component/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Component</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Flip Card</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Component</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Drag to flip cards</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/components/animated-gradient/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Component</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Animated Gradients</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Component</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Image reveal effect</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/plugins/json-sync/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Plugin</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">JSON Sync</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Plugin</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Import &amp; export CMS with JSON</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/templates/baseform/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Template</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Baseform</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Template</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Modern design portfolio</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/plugins/asset-manager/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Image">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Plugin</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Asset Manager</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Plugin</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Manage your site's assets</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
                <div data-framer-name="Milo" name="Milo">
                 <a name="Milo" data-framer-name="Pause" href="https://www.framer.com/marketplace/components/videoplayer/">
                  <div data-border="true" data-framer-name="Visual">
                   <div data-framer-name="Wrapper">
                    <div data-framer-name="Hover">
                     <div data-framer-background-image-wrapper="true">
                      <img alt="Framer marketplace item" data-framer-original-sizes="240px">
                     </div>
                    </div>
                   </div>
                   <button data-framer-name="Button 2025" data-reset="button">
                    <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
                     <p>View Component</p>
                    </div>
                   </button>
                  </div>
                  <div data-framer-name="Text">
                   <div data-framer-component-type="RichTextContainer">
                    <p data-styles-preset="XHuCPIQKc">Video Player</p>
                   </div>
                   <div data-framer-name="Bottom">
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Component</p>
                    </div>
                    <div data-framer-component-type="RichTextContainer">
                     <p data-styles-preset="XHuCPIQKc">Beautiful video player</p>
                    </div>
                   </div>
                  </div>
                 </a>
                </div>
               </div>
              </li>
             </ul>
            </div>
           </div>
          </div>
         </section>
        </main>
       </div>
       <div data-framer-name="New Pivot">
        <header data-framer-name="Header">
         <div data-framer-name="Text">
          <div data-framer-component-type="RichTextContainer">
           <h5 data-styles-preset="MdQYemVBT">Design bold. Launch fast.</h5>
          </div>
         </div>
         <div data-framer-name="Buttons">
          <a data-signup-debug-id="bottom-sign-up" data-framer-name="Regular" data-highlight="true" data-reset="button" href="https://framer.com/r/signup">
           <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
            <p>Start for free</p>
           </div>
          </a>
          <a data-framer-name="Regular" data-highlight="true" data-reset="button" href="./wireframer/">
           <div data-framer-name="Default" data-framer-component-type="RichTextContainer">
            <p>Start with AI</p>
           </div>
          </a>
         </div>
        </header>
       </div>
       <div>
        <footer data-framer-name="Desktop">
         <div>
          <div data-framer-name="Logo">
           <div>
            <a data-framer-name="On" data-highlight="true" href="./" data-framer-page-link-current="true"></a>
            <div>
             <a aria-label="Twitter / X" data-framer-name="X" href="https://x.com/framer" target="_blank"></a>
             <a aria-label="Threads" data-framer-name="Threads" href="https://www.threads.com/@framer" target="_blank"></a>
             <a aria-label="TikTok" data-framer-name="TikTok" href="https://www.tiktok.com/@framer" target="_blank"></a>
             <a aria-label="Instagram" data-framer-name="Instagram" href="https://www.instagram.com/framer/" target="_blank"></a>
             <a aria-label="LinkedIn" data-framer-name="LinkedIn" href="https://www.linkedin.com/company/framer/" target="_blank"></a>
             <a aria-label="YouTube" data-framer-name="YouTube" href="https://www.youtube.com/@Framer" target="_blank"></a>
            </div>
            <div data-framer-name="Variant 1">
             <a data-framer-name="Loading" href="https://www.framerstatus.com/" target="_blank">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Loading status</div>
              </div>
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>loading</div>
              </div>
             </a>
            </div>
            <div>
             <div data-framer-name="Layer Title" data-framer-component-type="RichTextContainer">
              <p>CCPA</p>
             </div>
             <div data-framer-name="Variant 1">
              <div data-framer-component-type="RichTextContainer">
               <p>© Framer B.V.</p>
              </div>
              <p>2026</p>
             </div>
            </div>
           </div>
          </div>
          <div data-framer-name="Lists">
           <div>
            <div data-framer-name="Product">
             <div data-framer-name="Nav/Topbar Link">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Product</div>
              </div>
             </div>
             <a data-framer-name="Label" data-highlight="true" href="./ai/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>AI</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./design/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Design</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./publish/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Publish</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./cms/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>CMS</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./scale/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Scale</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./seo/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>SEO</div>
              </div>
              <div data-border="true" data-framer-name="Label">
               <div data-framer-component-type="RichTextContainer">
                <p>New</p>
               </div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./collaborate/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Collaborate</div>
              </div>
             </a>
            </div>
            <div data-framer-name="Company">
             <div data-framer-name="Nav/Topbar Link">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Business</div>
              </div>
             </div>
             <a data-framer-name="Label" data-highlight="true" href="./pricing">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Pricing</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./switch/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Switch</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./startups/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Startups</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./agencies/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Agencies</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./enterprise/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Enterprise</div>
              </div>
             </a>
            </div>
           </div>
           <div>
            <div data-framer-name="Compare">
             <div data-framer-name="Nav/Topbar Link">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Compare</div>
              </div>
             </div>
             <a data-framer-name="Label" data-highlight="true" href="./compare/framer-vs-figma">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Figma</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./compare/framer-vs-webflow">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Webflow</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./compare/framer-vs-wordpress">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Wordpress</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./compare/framer-vs-squarespace">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Squarespace</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./compare/framer-vs-unbounce">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Unbounce</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./compare/framer-vs-wix">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Wix</div>
              </div>
             </a>
            </div>
            <div data-framer-name="Solutions">
             <div data-framer-name="Nav/Topbar Link">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Solutions</div>
              </div>
             </div>
             <a data-framer-name="Label" data-highlight="true" href="./solutions/figma-to-html/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Figma to HTML</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./solutions/website-builder/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Website builder</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./solutions/portfolio-website/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Portfolio maker</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./solutions/landing-pages/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Landing pages</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./solutions/ui-ux-design/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>UI/UX design</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./solutions/no-code-website-builder/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>No-code</div>
              </div>
             </a>
            </div>
           </div>
           <div data-framer-name="Resources">
            <div data-framer-name="Nav/Topbar Link">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Resources</div>
             </div>
            </div>
            <a data-framer-name="Label" data-highlight="true" href="https://www.framer.com/marketplace/templates/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Templates</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="https://www.framer.com/marketplace/components/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Components</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="https://www.framer.com/marketplace/plugins/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Plugins</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="https://www.framer.com/marketplace/vectors/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Vectors</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="https://www.framer.com/marketplace/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Marketplace</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./downloads/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Downloads</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./developers/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Developers</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./wallpapers/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Wallpapers</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./newsletter">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Newsletter</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./updates">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Updates</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./help/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Support</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./contact/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Contact</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./brand">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Brand</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./blog/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Blog</div>
             </div>
            </a>
           </div>
           <div>
            <div data-framer-name="Company">
             <div data-framer-name="Nav/Topbar Link">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Company</div>
              </div>
             </div>
             <a data-framer-name="Label" data-highlight="true" href="./meetups/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Meetups</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./careers/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Careers</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./legal/security/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Security</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="mailto:abuse@framer.com">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Abuse</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./brand">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Media</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./legal/terms-of-service/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Legal</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./store">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Store</div>
              </div>
              <div data-border="true" data-framer-name="Label">
               <div data-framer-component-type="RichTextContainer">
                <p>New</p>
               </div>
              </div>
             </a>
            </div>
            <div data-framer-name="Company">
             <div data-framer-name="Nav/Topbar Link">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Programs</div>
              </div>
             </div>
             <a data-framer-name="Label" data-highlight="true" href="./creators">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Affiliates</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./expert/apply/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Experts</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./creators">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Creators</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./education/students/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Students</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./education/ambassadors/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Ambassadors</div>
              </div>
             </a>
            </div>
           </div>
          </div>
         </div>
        </footer>
        <footer data-framer-name="Tablet">
         <div>
          <div data-framer-name="Logo">
           <div>
            <a data-framer-name="On" data-highlight="true" href="./" data-framer-page-link-current="true"></a>
            <div>
             <a aria-label="Twitter / X" data-framer-name="X" href="https://x.com/framer" target="_blank"></a>
             <a aria-label="Threads" data-framer-name="Threads" href="https://www.threads.com/@framer" target="_blank"></a>
             <a aria-label="TikTok" data-framer-name="TikTok" href="https://www.tiktok.com/@framer" target="_blank"></a>
             <a aria-label="Instagram" data-framer-name="Instagram" href="https://www.instagram.com/framer/" target="_blank"></a>
             <a aria-label="LinkedIn" data-framer-name="LinkedIn" href="https://www.linkedin.com/company/framer/" target="_blank"></a>
             <a aria-label="YouTube" data-framer-name="YouTube" href="https://www.youtube.com/@Framer" target="_blank"></a>
            </div>
            <div data-framer-name="Variant 1">
             <a data-framer-name="Loading" href="https://www.framerstatus.com/" target="_blank">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Loading status</div>
              </div>
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>loading</div>
              </div>
             </a>
            </div>
            <div>
             <div data-framer-name="Layer Title" data-framer-component-type="RichTextContainer">
              <p>CCPA</p>
             </div>
             <div data-framer-name="Variant 1">
              <div data-framer-component-type="RichTextContainer">
               <p>© Framer B.V.</p>
              </div>
              <p>2026</p>
             </div>
            </div>
           </div>
          </div>
          <div data-framer-name="Lists">
           <div>
            <div data-framer-name="Product">
             <div data-framer-name="Nav/Topbar Link">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Product</div>
              </div>
             </div>
             <a data-framer-name="Label" data-highlight="true" href="./ai/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>AI</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./design/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Design</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./publish/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Publish</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./cms/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>CMS</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./scale/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Scale</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./seo/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>SEO</div>
              </div>
              <div data-border="true" data-framer-name="Label">
               <div data-framer-component-type="RichTextContainer">
                <p>New</p>
               </div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./collaborate/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Collaborate</div>
              </div>
             </a>
            </div>
            <div data-framer-name="Company">
             <div data-framer-name="Nav/Topbar Link">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Business</div>
              </div>
             </div>
             <a data-framer-name="Label" data-highlight="true" href="./pricing">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Pricing</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./switch/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Switch</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./startups/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Startups</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./agencies/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Agencies</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./enterprise/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Enterprise</div>
              </div>
             </a>
            </div>
           </div>
           <div>
            <div data-framer-name="Compare">
             <div data-framer-name="Nav/Topbar Link">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Compare</div>
              </div>
             </div>
             <a data-framer-name="Label" data-highlight="true" href="./compare/framer-vs-figma">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Figma</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./compare/framer-vs-webflow">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Webflow</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./compare/framer-vs-wordpress">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Wordpress</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./compare/framer-vs-squarespace">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Squarespace</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./compare/framer-vs-unbounce">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Unbounce</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./compare/framer-vs-wix">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Wix</div>
              </div>
             </a>
            </div>
            <div data-framer-name="Solutions">
             <div data-framer-name="Nav/Topbar Link">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Solutions</div>
              </div>
             </div>
             <a data-framer-name="Label" data-highlight="true" href="./solutions/figma-to-html/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Figma to HTML</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./solutions/website-builder/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Website builder</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./solutions/portfolio-website/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Portfolio maker</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./solutions/landing-pages/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Landing pages</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./solutions/ui-ux-design/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>UI/UX design</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./solutions/no-code-website-builder/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>No-code</div>
              </div>
             </a>
            </div>
           </div>
           <div data-framer-name="Resources">
            <div data-framer-name="Nav/Topbar Link">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Resources</div>
             </div>
            </div>
            <a data-framer-name="Label" data-highlight="true" href="https://www.framer.com/marketplace/templates/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Templates</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="https://www.framer.com/marketplace/components/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Components</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="https://www.framer.com/marketplace/plugins/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Plugins</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="https://www.framer.com/marketplace/vectors/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Vectors</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="https://www.framer.com/marketplace/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Marketplace</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./downloads/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Downloads</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./developers/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Developers</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./wallpapers/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Wallpapers</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./newsletter">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Newsletter</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./updates">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Updates</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./help/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Support</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./contact/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Contact</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./brand">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Brand</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./blog/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Blog</div>
             </div>
            </a>
           </div>
           <div>
            <div data-framer-name="Company">
             <div data-framer-name="Nav/Topbar Link">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Company</div>
              </div>
             </div>
             <a data-framer-name="Label" data-highlight="true" href="./meetups/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Meetups</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./careers/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Careers</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./legal/security/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Security</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="mailto:abuse@framer.com">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Abuse</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./brand">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Media</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./legal/terms-of-service/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Legal</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./store">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Store</div>
              </div>
              <div data-border="true" data-framer-name="Label">
               <div data-framer-component-type="RichTextContainer">
                <p>New</p>
               </div>
              </div>
             </a>
            </div>
            <div data-framer-name="Company">
             <div data-framer-name="Nav/Topbar Link">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Programs</div>
              </div>
             </div>
             <a data-framer-name="Label" data-highlight="true" href="./creators">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Affiliates</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./expert/apply/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Experts</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./creators">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Creators</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./education/students/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Students</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./education/ambassadors/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Ambassadors</div>
              </div>
             </a>
            </div>
           </div>
          </div>
         </div>
        </footer>
        <footer data-framer-name="Mobile">
         <div>
          <div data-framer-name="Logo">
           <div>
            <a data-framer-name="On" data-highlight="true" href="./" data-framer-page-link-current="true"></a>
            <div data-framer-name="Variant 1">
             <a data-framer-name="Loading" href="https://www.framerstatus.com/" target="_blank">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Loading status</div>
              </div>
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>loading</div>
              </div>
             </a>
            </div>
           </div>
          </div>
          <div data-framer-name="Lists">
           <div>
            <div data-framer-name="Product">
             <div data-framer-name="Nav/Topbar Link">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Product</div>
              </div>
             </div>
             <a data-framer-name="Label" data-highlight="true" href="./ai/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>AI</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./design/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Design</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./publish/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Publish</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./cms/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>CMS</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./scale/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Scale</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./seo/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>SEO</div>
              </div>
              <div data-border="true" data-framer-name="Label">
               <div data-framer-component-type="RichTextContainer">
                <p>New</p>
               </div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./collaborate/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Collaborate</div>
              </div>
             </a>
            </div>
            <div data-framer-name="Company">
             <div data-framer-name="Nav/Topbar Link">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Business</div>
              </div>
             </div>
             <a data-framer-name="Label" data-highlight="true" href="./pricing">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Pricing</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./switch/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Switch</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./startups/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Startups</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./agencies/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Agencies</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./enterprise/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Enterprise</div>
              </div>
             </a>
            </div>
           </div>
           <div>
            <div data-framer-name="Compare">
             <div data-framer-name="Nav/Topbar Link">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Compare</div>
              </div>
             </div>
             <a data-framer-name="Label" data-highlight="true" href="./compare/framer-vs-figma">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Figma</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./compare/framer-vs-webflow">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Webflow</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./compare/framer-vs-wordpress">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Wordpress</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./compare/framer-vs-squarespace">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Squarespace</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./compare/framer-vs-unbounce">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Unbounce</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./compare/framer-vs-wix">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Wix</div>
              </div>
             </a>
            </div>
            <div data-framer-name="Solutions">
             <div data-framer-name="Nav/Topbar Link">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Solutions</div>
              </div>
             </div>
             <a data-framer-name="Label" data-highlight="true" href="./solutions/figma-to-html/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Figma to HTML</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./solutions/website-builder/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Website builder</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./solutions/portfolio-website/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Portfolio maker</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./solutions/landing-pages/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Landing pages</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./solutions/ui-ux-design/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>UI/UX design</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./solutions/no-code-website-builder/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>No-code</div>
              </div>
             </a>
            </div>
           </div>
           <div data-framer-name="Resources">
            <div data-framer-name="Nav/Topbar Link">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Resources</div>
             </div>
            </div>
            <a data-framer-name="Label" data-highlight="true" href="https://www.framer.com/marketplace/templates/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Templates</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="https://www.framer.com/marketplace/components/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Components</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="https://www.framer.com/marketplace/plugins/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Plugins</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="https://www.framer.com/marketplace/vectors/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Vectors</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="https://www.framer.com/marketplace/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Marketplace</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./downloads/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Downloads</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./developers/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Developers</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./wallpapers/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Wallpapers</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./newsletter">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Newsletter</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./updates">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Updates</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./help/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Support</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./contact/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Contact</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./brand">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Brand</div>
             </div>
            </a>
            <a data-framer-name="Label" data-highlight="true" href="./blog/">
             <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
              <div>Blog</div>
             </div>
            </a>
           </div>
           <div>
            <div data-framer-name="Company">
             <div data-framer-name="Nav/Topbar Link">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Company</div>
              </div>
             </div>
             <a data-framer-name="Label" data-highlight="true" href="./meetups/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Meetups</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./careers/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Careers</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./legal/security/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Security</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="mailto:abuse@framer.com">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Abuse</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./brand">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Media</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./legal/terms-of-service/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Legal</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./store">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Store</div>
              </div>
              <div data-border="true" data-framer-name="Label">
               <div data-framer-component-type="RichTextContainer">
                <p>New</p>
               </div>
              </div>
             </a>
            </div>
            <div data-framer-name="Company">
             <div data-framer-name="Nav/Topbar Link">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Programs</div>
              </div>
             </div>
             <a data-framer-name="Label" data-highlight="true" href="./creators">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Affiliates</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./expert/apply/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Experts</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./creators">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Creators</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./education/students/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Students</div>
              </div>
             </a>
             <a data-framer-name="Label" data-highlight="true" href="./education/ambassadors/">
              <div data-framer-name="Item" data-framer-component-type="RichTextContainer">
               <div>Ambassadors</div>
              </div>
             </a>
            </div>
           </div>
          </div>
         </div>
         <div data-framer-name="Layer Title" data-framer-component-type="RichTextContainer">
          <p>CCPA</p>
         </div>
         <div>
          <a href="https://x.com/framer" target="_blank"></a>
          <a href="https://www.threads.com/@framer" target="_blank"></a>
          <a href="https://www.tiktok.com/@framer" target="_blank"></a>
          <a href="https://www.instagram.com/framer/" target="_blank"></a>
          <a href="https://www.linkedin.com/company/framer/" target="_blank"></a>
          <a href="https://www.youtube.com/@Framer" target="_blank"></a>
         </div>
         <div data-framer-name="Variant 1">
          <div data-framer-component-type="RichTextContainer">
           <p>© Framer B.V.</p>
          </div>
          <p>2026</p>
         </div>
        </footer>
       </div>
      </div>
     </div>
    </html>
    "
  `,
  )
})

test('removes empty elements', async () => {
  const html = `
    <div>
      <span></span>
      <span></span>
      <p>content</p>
      <div></div>
    </div>
  `
  const result = await formatHtmlForPrompt({ html })

  // All empty elements should be removed
  expect(result).toMatchInlineSnapshot(`
    "<p>content</p>
    "
  `)
})

test('keeps empty elements that have attributes', async () => {
  const html = `
    <div>
      <span data-framer-name="a"></span>
      <span data-framer-name="b"></span>
      <span></span>
    </div>
  `
  const result = await formatHtmlForPrompt({ html })

  // Empty elements with attributes should remain, empty without attrs removed
  expect(result).toMatchInlineSnapshot(`
    "
    "
  `)
})

test('keeps style and class attributes when keepStyles is true', async () => {
  const html = `
    <div class="container" style="color: red;">
      <span class="text" style="font-size: 16px;">Hello</span>
    </div>
  `
  const result = await formatHtmlForPrompt({ html, keepStyles: true })

  expect(result).toMatchInlineSnapshot(`
    "<div class="container" style="color: red;">
     <span class="text" style="font-size: 16px;">Hello</span>
    </div>
    "
  `)
})

test('removes style and class attributes by default', async () => {
  const html = `
    <div class="container" style="color: red;">
      <span class="text">Hello</span>
    </div>
  `
  const result = await formatHtmlForPrompt({ html })

  expect(result).toMatchInlineSnapshot(`
    "<span>Hello</span>
    "
  `)
})

test('always keeps data-* attributes', async () => {
  const html = `
    <div data-testid="main" data-custom="value" class="hidden">
      <span data-id="123">Text</span>
    </div>
  `
  const result = await formatHtmlForPrompt({ html })

  expect(result).toMatchInlineSnapshot(`
    "<div data-testid="main" data-custom="value">
     <span data-id="123">Text</span>
    </div>
    "
  `)
})

test('truncates long attribute values', async () => {
  const longValue = 'a'.repeat(50)
  const html = `<div data-long="${longValue}">short</div>`
  const result = await formatHtmlForPrompt({ html, maxAttrLen: 20 })

  expect(result).toMatchInlineSnapshot(`
    "<div data-long="aaaaaaaaaaaaaaaaaaaa...30 more characters">short</div>
    "
  `)
})

test('truncates long text content', async () => {
  const longContent = 'word '.repeat(50)
  const html = `<p>${longContent}</p>`
  const result = await formatHtmlForPrompt({ html, maxContentLen: 30 })

  expect(result).toMatchInlineSnapshot(`
    "<p>word word word word word word ...220 more characters</p>
    "
  `)
})

test('always keeps test ID attributes', async () => {
  const html = `
    <div data-testid="container" data-cy="main" class="hidden">
      <button testid="btn" test-id="submit" data-test="action">Click</button>
    </div>
  `
  const result = await formatHtmlForPrompt({ html })

  expect(result).toMatchInlineSnapshot(`
    "<div data-testid="container" data-cy="main">
     <button testid="btn" test-id="submit" data-test="action">Click</button>
    </div>
    "
  `)
})

test('keeps all common e2e test ID attributes', async () => {
  const html = `
    <div tid="short" qa="quality" qa-id="qa1" e2e="test" e2e-id="e2e1" class="hidden">
      <button automation-id="auto1" automationid="auto2" selenium="sel1" pw="play1">Click</button>
      <span data-qa="dataqa" data-automation="dataauto" data-pw="datapw">Text</span>
    </div>
  `
  const result = await formatHtmlForPrompt({ html })

  expect(result).toMatchInlineSnapshot(`
    "<div tid="short" qa="quality" qa-id="qa1" e2e="test" e2e-id="e2e1">
     <button automation-id="auto1" automationid="auto2" selenium="sel1" pw="play1">Click</button>
     <span data-qa="dataqa" data-automation="dataauto" data-pw="datapw">Text</span>
    </div>
    "
  `)
})

test('processes x.com.html with size savings', async () => {
  const html = fs.readFileSync(new URL('./assets/x.com.html', import.meta.url), 'utf-8')

  const result = await formatHtmlForPrompt({ html })
  const resultWithStyles = await formatHtmlForPrompt({ html, keepStyles: true })

  const originalSize = html.length
  const originalTokens = Math.ceil(originalSize / 4)

  const processedSize = result.length
  const processedTokens = Math.ceil(processedSize / 4)
  const savings = originalSize - processedSize
  const savingsPercent = ((savings / originalSize) * 100).toFixed(1)

  const withStylesSize = resultWithStyles.length
  const withStylesTokens = Math.ceil(withStylesSize / 4)
  const withStylesSavings = originalSize - withStylesSize
  const withStylesPercent = ((withStylesSavings / originalSize) * 100).toFixed(1)

  console.log(`\n📊 x.com.html processing stats:`)
  console.log(`   Original:     ${originalSize.toLocaleString()} chars (${originalTokens.toLocaleString()} tokens)`)
  console.log(`   Without styles: ${processedSize.toLocaleString()} chars (${processedTokens.toLocaleString()} tokens) - ${savingsPercent}% savings`)
  console.log(`   With styles:    ${withStylesSize.toLocaleString()} chars (${withStylesTokens.toLocaleString()} tokens) - ${withStylesPercent}% savings`)

  await expect(result).toMatchFileSnapshot('./__snapshots__/x.com.processed.html')
  await expect(resultWithStyles).toMatchFileSnapshot('./__snapshots__/x.com.processed.withStyles.html')
})

test('unwraps unnecessary nested wrapper divs', async () => {
  const html = `
    <div>
      <div>
        <div>
          <p>content</p>
        </div>
      </div>
    </div>
  `
  const result = await formatHtmlForPrompt({ html })

  // Should unwrap to a single div containing the p
  expect(result).toMatchInlineSnapshot(`
    "<p>content</p>
    "
  `)
})
