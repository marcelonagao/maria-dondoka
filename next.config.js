/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // O navegador precisa revalidar o service worker a cada abertura; com cache longo,
        // uma correção nele demoraria a chegar aos aparelhos.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
