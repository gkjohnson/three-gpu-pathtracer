import { exec } from 'child_process';
import fs from 'fs';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export function runScript( command ) {

	return new Promise( resolve => {

		const proc = exec( command );
		proc.stderr.pipe( process.stderr );
		proc.stdout.pipe( process.stdout );
		proc.on( 'exit', () => {

			resolve();

		} );

	} );

}

export function compareImageDirectories( path1, path2, threshold = 0.1 ) {

	// TODO: get files from path1
	// TODO: ensure files are in both places
	// TODO: iterate over all and check results from both
	// TODO: return a message and whether it passes or fails

}

function compareImages( path1, path2, threshold = 0.1 ) {

	const img1 = PNG.sync.read( fs.readFileSync( path1 ) );
	const img2 = PNG.sync.read( fs.readFileSync( path2 ) );
	const { width, height } = img1;

	const diffPixels = pixelmatch( img1.data, img2.data, null, width, height, { threshold } );
	return diffPixels / ( width * height );

}
