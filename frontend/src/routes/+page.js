/** @type {import('./$types').PageLoad} */
export function load() {
    // Return empty form data to satisfy SvelteKit's form prop requirement
    return {
        form: {}
    };
}
