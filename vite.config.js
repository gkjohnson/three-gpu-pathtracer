import { searchForWorkspaceRoot } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

export default ( { mode } ) => ( {

	plugins: mode === 'ssl' ? [ basicSsl(), react() ] : [ react() ],

	root: './example/',
	base: '',
	build: {
		outDir: './bundle/',
		sourcemap: true,
		rollupOptions: {
			input: fs
				.readdirSync( './example/' )
				.filter( p => /\.html$/.test( p ) )
				.map( p => path.resolve( './example/', p ) ),
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
} );
