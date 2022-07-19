import simpleGit from 'simple-git';
import { execSync } from 'child_process';

( async() => {

	const git = simpleGit();
	const status = await git.status();
	const currentBranch = status.current;

	// if ( currentBranch !== 'main' ) {

	// 	console.error( 'Current branch is not set to main.' );
	// 	process.exit( 1 );

	// }

	const modified = status.modified.length + status.created.length + status.renamed.length + status.deleted.length;
	if ( modified !== 0 ) {

		console.error( 'Current branch is not clean.' );
		process.exit( 1 );

	}

	console.log( 'Switching to "screenshots" branch' );
	await git.checkout( 'screenshots' );

	console.log( 'Rebasing onto "main".' );
	await git.rebase( [ 'main', 'screenshots' ] );

	// execSync( 'node ./scripts/update-screenshots.js' );

	console.log( 'Committing all screenshots.' );
	await git
		.add( './screenshots/goldens/*' )
		.commit( 'update screenshots' );

	console.log( 'Pushing commit.' );
	await git.push( 'origin', 'screenshots' );

	console.log( `Switching back to "${ currentBranch }" branch.` );
	await git.checkout( currentBranch );

	process.exit();

} )();
