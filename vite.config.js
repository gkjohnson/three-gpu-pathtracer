import { searchForWorkspaceRoot } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import fs from 'fs';

export default ( { mode } ) => ( {

	plugins: mode === 'ssl' ? [ basicSsl() ] : [],

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
    	exclude: [ 'three-mesh-bvh', '@monogrid/gainmap-js' ],
  	},
} );
