import { searchForWorkspaceRoot } from 'vite';
import fs from 'fs';

export default {

	root: './example/',
	base: '',
	build: {
		outDir: './bundle/',
		sourcemap: true,
		rollupOptions: {
			input: fs
				.readdirSync( './example/' )
				.filter( p => /\.html$/.test( p ) )
				.map( p => `./example/${ p }` ),
		},
	},
	server: {
		fs: {
			allow: [
				// search up for workspace root
				searchForWorkspaceRoot( process.cwd() ),
			],
		},
	},
	optimizeDeps: {
    	exclude: [ 'three-mesh-bvh' ],
  	},
};
