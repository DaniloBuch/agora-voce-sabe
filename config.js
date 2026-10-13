// Configuração do Supabase (veja SETUP-SUPABASE.md, passo 4).
// Estes dois valores são PÚBLICOS por natureza (ficam visíveis no navegador),
// então não tem problema subir este arquivo para o GitHub.
// Enquanto estiverem vazios, o site continua lendo o db.json normalmente.
window.CBS_CONFIG = {
  SUPABASE_URL: "https://kgnxvqubeuxtavwlonfp.supabase.co/rest/v1/", // ex.: "https://abcdefghijkl.supabase.co"
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtnbnh2cXViZXV4dGF2d2xvbmZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4OTczMTgsImV4cCI6MjEwNzQ3MzMxOH0.kC5Yc81WfOfHQLjRdzAebzBlfiq8s0075vM03NrqmRU", // chave "anon public" (ou "publishable") do projeto
};
