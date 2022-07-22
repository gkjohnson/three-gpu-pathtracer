import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

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

export function compareImageDirectories( path1, path2, pixelThreshold = 0.1, diffThreshold = 0.1 ) {

	let failures = 0;
	let total = 0;
	const files = fs.readdirSync( path1 );
	for ( const key in files ) {

		const f = files[ key ];
		const fileName = path.basename( f );
		total ++;

		if ( fs.existsSync( path.resolve( path2, fileName ) ) ) {

			console.log( `Comparing "${ fileName }" screenshots.`);
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

export function compareImages( path1, path2, threshold = 0.1, diffPath = null ) {

	const img1 = PNG.sync.read( fs.readFileSync( path1 ) );
	const img2 = PNG.sync.read( fs.readFileSync( path2 ) );

	const { width, height } = img1;
	const diff = new PNG( { width, height } );

	const diffPixels = pixelmatch( img1.data, img2.data, diff.data, width, height, { threshold } );
	if ( diffPath ) {

		const buffer = PNG.sync.write( diff, { colorType: 6 } );
		fs.writeFileSync( diffPath, buffer );

	}

	return diffPixels / ( width * height );

}
