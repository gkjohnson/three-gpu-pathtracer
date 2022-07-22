import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

// runs a given command with stdio output and errors thrown
export function runScript( command ) {

	return new Promise( ( resolve, reject ) => {

		const proc = exec( command );
		proc.stderr.pipe( process.stderr );
		proc.stdout.pipe( process.stdout );
		proc.on( 'exit', code => {

			if ( code === 0 ) resolve();
			else reject();

		} );

	} );

}

// Compare the images in two directories and compare results
export function compareImageDirectories( path1, path2, pixelThreshold = 0.1, diffThreshold = 0.1 ) {

	let failures = 0;
	let total = 0;
	const files = fs.readdirSync( path1 );
	for ( const key in files ) {

		const f = files[ key ];
		const fileName = path.basename( f );
		total ++;

		if ( fs.existsSync( path.resolve( path2, fileName ) ) ) {

			console.log( `Comparing "${ fileName }" screenshots.` );
			const diff =
				compareImages(
					path.resolve( path1, fileName ),
					path.resolve( path2, fileName ),
					pixelThreshold,
				);


			let status = 'Pass';
			if ( diff > diffThreshold ) {

				status = 'Fail';
				failures ++;

			}

			console.log( `\t${ status }: Images are ${ ( 100 * diff ).toFixed( 2 ) }% different` );

		} else {

			console.error( `File "${ fileName }" does not not exist in both directories.` );

		}

	}

	console.log( `${ failures } out of ${ total } comparisons failed.` );

	return failures !== 0;

}

// Compares images at the given path
export function compareImages( path1, path2, threshold = 0.1, diffPath = null ) {

	// Checks if two files exist before diffing
	if ( ! fs.existsSync( path1 ) || ! fs.existsSync( path2 ) ) {

		throw new Error( `File "${ path.basename( path1 ) }" does not not exist in both directories.` );

	}

	// Reads the two files
	const img1 = PNG.sync.read( fs.readFileSync( path1 ) );
	const img2 = PNG.sync.read( fs.readFileSync( path2 ) );

	const { width, height } = img1;
	const diff = new PNG( { width, height } );

	// checks the diff
	const diffPixels = pixelmatch( img1.data, img2.data, diff.data, width, height, { threshold } );

	// writes the pixels out if path is provided.
	if ( diffPath ) {

		const buffer = PNG.sync.write( diff, { colorType: 6 } );
		fs.writeFileSync( diffPath, buffer );

	}

	// returns the ratio of different pixels
	return diffPixels / ( width * height );

}
