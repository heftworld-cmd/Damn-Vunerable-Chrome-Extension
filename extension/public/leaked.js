// DVCE Lab: Simulated "secret" exposed via web_accessible_resources.
// Real extensions should NEVER ship secrets in the package (and never expose them to websites).
window.DVCE_LEAK = {
  fakeApiKey: "DVCE_FAKE_API_KEY_DO_NOT_USE",
  note: "If this file were exposed to <all_urls>, any website could load it via a <script> tag."
};
