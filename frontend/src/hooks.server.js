/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
  const response = await resolve(event);

  // Match backend CORS configuration
  if (import.meta.env.PROD) {
    const allowedOrigins = [
      'https://frontend-production-2748.up.railway.app',
      'https://backend-production-6e08.up.railway.app',
      'http://localhost:5173',
      'http://localhost:3000'
    ];
    const origin = event.request.headers.get('origin');
    
    if (!origin || allowedOrigins.includes(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin || '*');
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
      response.headers.set('Access-Control-Expose-Headers', 'Content-Disposition');
      response.headers.set('Access-Control-Allow-Credentials', 'true');
      response.headers.set('Access-Control-Max-Age', '3600');
    }

    response.headers.set('X-Railway-Service', 'frontend');
  }

  return response;
}
