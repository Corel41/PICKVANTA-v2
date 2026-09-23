/* ==========================================================================
   PickVanta — example configuration (js/config.example.js)
   --------------------------------------------------------------------------
   Copy this file's contents over js/config.js to point the site at a real
   Supabase project. Everything here is PUBLIC:

     url      the project URL, e.g. https://abcdefghijklm.supabase.co
     anonKey  the project's anon (publishable) key. It is designed to be shipped
              to browsers; Row Level Security is what protects the data.

   NEVER put these in the repository:
     • service_role key
     • database password / connection string
     • any private key, JWT secret or personal access token

   onFailure — see js/config.js:
     'error'  show the error state when the live catalogue is unavailable (default)
     'demo'   serve the bundled demo dataset instead, clearly labelled as demo
   ========================================================================== */
/* Either edit the same block in js/config.js, or keep this file as
   js/config.local.js (git-ignored) and load it before js/config.js:

     <script src="js/config.local.js"></script>
     <script src="js/config.js"></script>

   A local file is only a convenience — the values are public either way. */
window.PV_CONFIG_OVERRIDE = {
  mode: 'api',
  supabase: {
    url: 'https://YOUR-PROJECT-REF.supabase.co',
    anonKey: 'YOUR-PUBLIC-ANON-KEY'
  },
  onFailure: 'error',
  poolLimit: 60
};
