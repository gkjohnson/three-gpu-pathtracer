import simpleGit from 'simple-git';
import { exec } from 'child_process';

function runScript( command ) {

	return new Promise( resolve => {

		const proc = exec( command );
		proc.stderr.pipe( process.stderr );
		proc.stdout.pipe( process.stdout );
		proc.on( 'exit', () => {

			resolve();

		} );

	} );

}

( async() => {

	const git = simpleGit();
	const status = await git.status();
	const currentBranch = status.current;

	if ( currentBranch !== 'main' ) {

		console.error( 'Current branch is not set to main' );
		process.exit( 1 );

	}

	const modified = status.modified.length + status.created.length + status.renamed.length + status.deleted.length;
	if ( modified !== 0 ) {

		console.error( 'Current branch is not clean' );
		process.exit( 1 );

	}

	// switch and rebase branches
	console.log( 'Switching to "screenshots" branch' );
	await git.checkout( 'screenshots' );

	console.log( 'Rebasing onto "main"' );
	await git.rebase( [ 'main', 'screenshots' ] );

	// rebuild the screenshots
	await runScript( 'node ./scripts/update-screenshots.js' );

	// commit and push the screenshots
	console.log( 'Committing all screenshots.' );
	try {

		await git
			.add( './screenshots/golden/' )
			.commit( 'update screenshots' );

		console.log( 'Pushing commit.' );
		await git.push( 'origin', 'screenshots' );

	} catch ( e ) {

		console.error( 'Could not find any new files to commit' );
		console.error( e.message );

	}

	// reset git
	console.log( `Switching back to "${ currentBranch }" branch` );
	await git.checkout( currentBranch );

	process.exit();

} )();
