import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { OIDNDenoiser } from '../src/webgpu/denoise/OIDNDenoiser.js';

const color = { width: 1, height: 1 };

function deferred() {

	let resolve, reject;
	const promise = new Promise( ( onResolve, onReject ) => {

		resolve = onResolve;
		reject = onReject;

	} );
	return { promise, resolve, reject };

}

function createDenoiser( loader = async () => ( { tileExecute: () => () => {} } ) ) {

	const denoiser = new OIDNDenoiser( {
		initUNetFromURL: loader,
		colorWeightsUrl: 'color-weights',
		auxWeightsUrl: 'aux-weights',
		useAuxiliaryBuffers: false,
	} );
	denoiser.init( {
		backend: { device: {}, get: () => ( { texture: {} } ) },
		initTexture() {},
	} );
	return denoiser;

}

test( 'an obsolete load failure does not restore the error after reset', async () => {

	const load = deferred();
	const denoiser = createDenoiser( () => load.promise );
	const error = new Error( 'old download failed' );
	const pass = denoiser.denoise( color );
	const rejected = assert.rejects( pass, error );
	denoiser.reset();
	load.reject( error );
	await rejected;
	assert.equal( denoiser.error, null );
	assert.equal( denoiser.running, false );

} );

test( 'an obsolete failure does not stop a newer pass using another model', async () => {

	const oldLoad = deferred();
	const newLoad = deferred();
	const denoiser = createDenoiser( ( url ) => url === 'color-weights' ? oldLoad.promise : newLoad.promise );
	const error = new Error( 'old download failed' );
	const oldPass = denoiser.denoise( color );
	const rejected = assert.rejects( oldPass, error );
	denoiser.reset();
	const newPass = denoiser.denoise( color, {}, {} );
	oldLoad.reject( error );
	await rejected;
	assert.equal( denoiser.error, null );
	assert.equal( denoiser.running, true );
	newLoad.resolve( { tileExecute: () => () => {} } );
	await newPass;
	assert.equal( denoiser.running, true );
	denoiser.reset();

} );

for ( const failingTexture of [ color, 'albedo', 'normal' ] ) {

	test( `texture setup failure (${ failingTexture === color ? 'color' : failingTexture }) is recorded and releases the pass`, async () => {

		const denoiser = createDenoiser();
		const error = new Error( 'texture setup failed' );
		denoiser.renderer.initTexture = texture => {

			if ( texture === failingTexture ) throw error;

		};

		await assert.rejects( denoiser.denoise( color, 'albedo', 'normal' ), error );
		assert.equal( denoiser.error, error );
		assert.equal( denoiser.running, false );
		assert.equal( denoiser.complete, false );
		denoiser.reset();
		denoiser.renderer.initTexture = () => {};

		await denoiser.denoise( color );
		assert.equal( denoiser.running, true );
		assert.equal( denoiser.error, null );
		denoiser.reset();

	} );

}

test( 'backend texture access failure is recorded', async () => {

	const denoiser = createDenoiser();
	const error = new Error( 'texture unavailable' );
	denoiser.renderer.backend.get = () => {

		throw error;

	};

	await assert.rejects( denoiser.denoise( color ), error );
	assert.equal( denoiser.error, error );
	assert.equal( denoiser.running, false );

} );

test( 'tile execution failure is recorded and direct calls still reject', async () => {

	const error = new Error( 'tile setup failed' );
	const denoiser = createDenoiser( async () => ( { tileExecute: () => {

		throw error;

	} } ) );
	await assert.rejects( denoiser.denoise( color ), error );
	assert.equal( denoiser.error, error );
	assert.equal( denoiser.running, false );
	assert.equal( denoiser.complete, false );

} );

test( 'update handles a failure without retrying every frame and reset permits another download', async () => {

	const error = new Error( 'download failed' );
	let attempts = 0;
	const denoiser = createDenoiser( async () => {

		attempts ++;
		if ( attempts === 1 ) throw error;
		return { tileExecute: () => () => {} };

	} );
	assert.equal( denoiser.update( color ), null );
	await setImmediate();
	assert.equal( denoiser.error, error );
	assert.equal( denoiser.running, false );
	denoiser.update( color );
	await setImmediate();
	assert.equal( attempts, 1 );
	denoiser.reset();
	denoiser.update( color );
	await setImmediate();
	assert.equal( attempts, 2 );
	assert.equal( denoiser.error, null );
	assert.equal( denoiser.running, true );
	denoiser.reset();

} );

test( 'successful model loads remain cached across resets', async () => {

	let attempts = 0;
	const denoiser = createDenoiser( async () => {

		attempts ++;
		return { tileExecute: () => () => {} };

	} );
	await denoiser.denoise( color );
	denoiser.reset();
	await denoiser.denoise( color );
	assert.equal( attempts, 1 );
	assert.equal( denoiser.running, true );
	denoiser.reset();

} );

test( 'obsolete callbacks cannot replace the output or complete a newer pass', async () => {

	const passes = [];
	const copies = [];
	let aborts = 0;
	const denoiser = createDenoiser( async () => ( {
		tileExecute: inputs => {

			passes.push( inputs );
			return () => {

				aborts ++;

			};

		},
	} ) );
	denoiser._copyOutputToTexture = output => copies.push( output );
	await denoiser.denoise( color );
	denoiser.reset();
	await denoiser.denoise( color );
	passes[ 0 ].progress( 'old-progress' );
	passes[ 0 ].done( 'old-result' );
	assert.deepEqual( copies, [] );
	assert.equal( denoiser.running, true );
	assert.equal( denoiser.complete, false );
	passes[ 1 ].progress( 'new-progress' );
	passes[ 1 ].done( 'new-result' );
	assert.deepEqual( copies, [ 'new-progress', 'new-result' ] );
	assert.equal( denoiser.running, false );
	assert.equal( denoiser.complete, true );
	denoiser.reset();
	assert.equal( aborts, 1 );

} );

test( 'disposing a pending failed load does not cause an unhandled rejection', async () => {

	const load = deferred();
	const denoiser = createDenoiser( () => load.promise );
	const error = new Error( 'download failed after disposal' );
	const rejected = assert.rejects( denoiser.denoise( color ), error );
	denoiser.dispose();
	load.reject( error );
	await rejected;
	await setImmediate();
	assert.equal( denoiser.error, null );

} );
