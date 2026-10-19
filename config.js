// Klar Glas – Intern: Zugangsdaten
// Solange SUPABASE_URL leer ist, läuft die App im Testmodus:
// Daten liegen dann nur in diesem Browser und sind für niemand anderen sichtbar.
window.KLARGLAS = {
  SUPABASE_URL: "https://iwkklvjfftrjembrgnwv.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_rSlCwQ_qWRGCEGLMfKkwzA_RrOjl5xG",
  // Google Kalender → Einstellungen → „Klar Glas“ → Kalender integrieren → Kalender-ID
  KALENDER_ID: "81b750ad3109807631e2d6bc3b2993a4a02717fff01e60da42f97cb9df63c721@group.calendar.google.com",
  // Push-Benachrichtigungen: öffentlicher Teil des Schlüssels (der private liegt nur als Secret in Supabase)
  VAPID_PUBLIC: "BJlQjdDdqtuCBPcLhNofa7YAOFCgwXznLbt0-Ychrb6IpkvHh78i0F0j2zOj4eMpL02H5HnzZ9kt9WELRGLTO6o",
  // Wer rein darf – als SHA-256 der E-Mail-Adresse, damit die Adressen nicht öffentlich im Code stehen.
  // Neue Person: Hash z. B. mit „echo -n adresse | shasum -a 256“ erzeugen.
  TEAM: {
    "2fb0cc0b8c3183c36e140f5e151d0c280029fa03607a15c082da213f3f02e441": "Louis",
    "770e565fe1d27d288b0d22b2d6c8c236c3cb0900740a5fd892d5b0b4adfee05a": "Louis",
    "16325763dfd6bdbc73504927b34cb45f570e8b49bbbc00d70fed7a08630d2bb3": "Lukas",
    "b10c2ad1f76a973493e93b19b8ab9b2ab619ff8a37b4ec6cda50e9a08500f381": "Lukas",
    "56130b1c824ed3f0488afd5b05d8c50459e5215292926e68b63536a494499400": "Klar Glas",
  },
};
