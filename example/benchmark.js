// Quality / performance benchmark for the WebGPU path tracer.
//
// Renders a fixed scene and camera at a fixed resolution, keeps a high sample count reference
// image, and measures configurations against it:
//   - equal time: the error after rendering for a fixed time
//   - time to complete: how long it takes until the render reports "complete"
//
// Driven from the console or an automation script through `window.bench`:
//   await bench.ready;
//   await bench.reference( 1024 );
//   await bench.run( { timeMs: 10000 } );
//   await bench.run( { maxSamples: 256 } );
//
// Every option of "run" not listed below is assigned to the path tracer, e.g. "adaptiveThreshold".
import {
	ACESFilmicToneMapping,
	Scene,
	EquirectangularReflectionMapping,
	WebGPURenderer,
	PerspectiveCamera,
	DataTexture,
	SRGBColorSpace,
	NoColorSpace,
	ColorManagement,
} from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/worker';
import { AtlasTexture } from 'three-gpu-pathtracer/src/webgpu/AtlasTexture.js';

const ENV_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/chinese_garden_1k.hdr';
const MODEL_URL = 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/terrarium-robots/scene.gltf';

const params = new URLSearchParams( location.search );
const WIDTH = parseInt( params.get( 'w' ) ?? '960' );
const HEIGHT = parseInt( params.get( 'h' ) ?? '540' );

// options consumed by the harness rather than assigned to the path tracer
const HARNESS_OPTIONS = [ 'timeMs', 'label', 'timeline', 'profile', 'megakernel', 'linearAtlas' ];

const logElement = document.getElementById( 'log' );
let renderer, pathTracer, camera, scene;
let referenceImage = null;

// [ ms, finished share, avg samples, gpu frame ms, frame budget ] samples of the last render
let timeline = [];
let usingMegakernel = false;
let usingLinearAtlas = false;
const isStoredEncoded = AtlasTexture.prototype._isStoredEncoded;

window.bench = {
	ready: init(),
	reference,
	run,
	readImage,
	atlasPrecision,

	// long jobs run in the background and are polled, so automation calls stay short:
	//   bench.start( 'reference', 8192 ); ... bench.status()
	start( name, ...args ) {

		const job = { name, done: false, result: null, error: null };
		this.job = job;
		this.ready
			.then( () => this[ name ]( ...args ) )
			.then( result => job.result = result )
			.catch( error => job.error = String( error ) )
			.finally( () => job.done = true );
		return name;

	},
	status() {

		return this.job ? { name: this.job.name, done: this.job.done, result: this.job.result, error: this.job.error, log: logElement.textContent } : null;

	},
};

function log( text ) {

	logElement.textContent = text;

}

async function init() {

	renderer = new WebGPURenderer( { antialias: false, trackTimestamp: true } );
	await renderer.init();
	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.setPixelRatio( 1 );
	renderer.setSize( WIDTH, HEIGHT );
	document.body.appendChild( renderer.domElement );

	pathTracer = new WebGPUPathTracer( renderer );
	pathTracer.setBVHWorker( GenerateMeshBVHWorker );

	// a new random sequence per render so runs aren't correlated with the reference
	pathTracer.stableNoise = false;

	camera = new PerspectiveCamera( 75, WIDTH / HEIGHT, 0.025, 500 );
	camera.position.set( 8, 9, 24 );
	camera.lookAt( 0, 10, 0 );

	scene = new Scene();
	scene.backgroundBlurriness = 0.05;

	const [ gltf, envTexture ] = await Promise.all( [
		new GLTFLoader().loadAsync( MODEL_URL ),
		new HDRLoader().loadAsync( ENV_URL ),
	] );

	envTexture.mapping = EquirectangularReflectionMapping;
	scene.background = envTexture;
	scene.environment = envTexture;
	scene.add( gltf.scene );

	await pathTracer.setScene( scene, camera );

	// render until the kernels are compiled and samples are landing
	pathTracer.maxSamples = 1;
	await renderUntil( () => pathTracer.complete, 120000 );
	log( 'ready' );
	window.bench.info = { cameraInVolume: pathTracer._pathTracer.cameraInVolume };

}

function nextFrame() {

	return new Promise( resolve => requestAnimationFrame( resolve ) );

}

async function renderUntil( done, timeoutMs ) {

	const start = performance.now();
	timeline = [];
	let lastMark = - Infinity;
	while ( ! done( performance.now() - start ) && performance.now() - start < timeoutMs ) {

		pathTracer.renderSample();
		await nextFrame();

		// the share of finished pixels, the gpu frame time and the budget over the render
		const t = performance.now() - start;
		if ( t - lastMark >= 250 ) {

			lastMark = t;
			const counts = pathTracer._lastSampleCounts;
			timeline.push( [ Math.round( t ), + counts.finished.toFixed( 4 ), + counts.avg.toFixed( 1 ), + pathTracer.frameTime.toFixed( 2 ), Math.round( pathTracer.frameBudget ) ] );

		}

	}

	// wait for queued gpu work so the elapsed time covers it
	await renderer.backend.device.queue.onSubmittedWorkDone();
	return performance.now() - start;

}

function applyOptions( options ) {

	// defaults restored before every run so runs don't leak settings into each other
	pathTracer.maxSamples = 0;
	if ( 'adaptiveThreshold' in pathTracer ) {

		pathTracer.adaptiveThreshold = 0;
		pathTracer.adaptiveMinSamples = 16;

	}

	// "linearAtlas" restores the previous atlas, which decoded sRGB textures to eight bit linear, for A / B
	// comparisons. Repacking the atlas needs its change detection cleared
	const linearAtlas = Boolean( options.linearAtlas );
	if ( linearAtlas !== usingLinearAtlas ) {

		AtlasTexture.prototype._isStoredEncoded = linearAtlas ? () => false : isStoredEncoded;
		pathTracer.textureAtlas.hashes = [];
		pathTracer.updateMaterials();
		usingLinearAtlas = linearAtlas;

	}

	// switching backends rebuilds the kernels, so only when it changes
	const megakernel = Boolean( options.megakernel );
	if ( megakernel !== usingMegakernel ) {

		pathTracer.useMegakernel( megakernel );
		usingMegakernel = megakernel;

	}

	for ( const key in options ) {

		if ( ! HARNESS_OPTIONS.includes( key ) ) {

			pathTracer[ key ] = options[ key ];

		}

	}

}

// reads the linear accumulated rgb of the output target
async function readImage() {

	const target = pathTracer._pathTracer.outputTarget;
	const { width, height } = target;
	const channels = [];
	for ( let layer = 0; layer < 3; layer ++ ) {

		channels.push( new Float32Array( await renderer.backend.copyTextureToBuffer( target, 0, 0, width, height, layer ) ) );

	}

	return { width, height, channels };

}

// Sums the gpu time of each kernel type over the timed updates, by wrapping the backend's dispatch.
// Returns a function that detaches it and returns the per kernel milliseconds, largest first.
function attachProfiler() {

	const backend = pathTracer._pathTracer;
	const { dispatch, _measureFrameTime } = backend;
	const totals = {};
	let names = [];

	backend.dispatch = function ( kernel, size ) {

		dispatch.call( this, kernel, size );
		if ( this._timestampUIDs ) {

			names.push( kernel.constructor.name );

		}

	};

	backend._measureFrameTime = async function ( uids ) {

		const frameNames = names;
		names = [];
		await _measureFrameTime.call( this, uids );

		const timestampBackend = renderer.backend;
		if ( uids.every( uid => timestampBackend.hasTimestampQuery( uid ) ) ) {

			uids.forEach( ( uid, i ) => {

				const name = frameNames[ i ] ?? 'unknown';
				totals[ name ] = ( totals[ name ] ?? 0 ) + timestampBackend.getTimestamp( uid );

			} );

		}

	};

	return () => {

		backend.dispatch = dispatch;
		backend._measureFrameTime = _measureFrameTime;
		const sum = Object.values( totals ).reduce( ( a, b ) => a + b, 0 );
		return Object.entries( totals )
			.sort( ( a, b ) => b[ 1 ] - a[ 1 ] )
			.map( ( [ name, ms ] ) => `${ name } ${ ( 100 * ms / sum ).toFixed( 1 ) }%` );

	};

}

async function render( options ) {

	applyOptions( options );
	pathTracer.reset();

	const restoreProfiler = options.profile ? attachProfiler() : null;
	const { timeMs = Infinity } = options;
	const elapsed = await renderUntil( t => pathTracer.complete || t >= timeMs, Math.min( timeMs, 600000 ) );
	const samples = await pathTracer.getSampleCountsAsync();
	const profile = restoreProfiler ? restoreProfiler() : undefined;
	return { elapsed, samples, profile };

}

// The reference is kept in IndexedDB so it survives page reloads while the engine is edited. It is
// ground truth, so any unbiased configuration converges to it.
function openReferenceStore() {

	return new Promise( ( resolve, reject ) => {

		const request = indexedDB.open( 'pathtracer-benchmark', 1 );
		request.onupgradeneeded = () => request.result.createObjectStore( 'references' );
		request.onsuccess = () => resolve( request.result );
		request.onerror = () => reject( request.error );

	} );

}

async function referenceStore( mode, key, value ) {

	const db = await openReferenceStore();
	return new Promise( ( resolve, reject ) => {

		const store = db.transaction( 'references', mode ).objectStore( 'references' );
		const request = mode === 'readonly' ? store.get( key ) : store.put( value, key );
		request.onsuccess = () => resolve( request.result );
		request.onerror = () => reject( request.error );

	} );

}

async function reference( maxSamples = 1024, force = false ) {

	const key = `${ WIDTH }x${ HEIGHT }@${ maxSamples }`;
	if ( ! force ) {

		try {

			const cached = await referenceStore( 'readonly', key );
			if ( cached ) {

				referenceImage = cached;
				log( `reference ${ key } loaded from cache` );
				return { cached: true, key };

			}

		} catch {

			// no storage, render it

		}

	}

	log( `rendering reference, ${ maxSamples } spp` );
	const { elapsed, samples } = await render( { maxSamples } );
	referenceImage = await readImage();
	try {

		await referenceStore( 'readwrite', key, referenceImage );

	} catch {

		// not cached, it will be rendered again next time

	}

	log( `reference done in ${ ( elapsed / 1000 ).toFixed( 1 ) }s` );
	return { elapsedMs: Math.round( elapsed ), avgSamples: samples.avg, key };

}

// relMSE and tone mapped RMSE against the reference, averaged over pixels and channels
function computeError( image ) {

	let relMse = 0;
	let tmSe = 0;
	let count = 0;
	for ( let c = 0; c < 3; c ++ ) {

		const a = image.channels[ c ];
		const r = referenceImage.channels[ c ];
		for ( let i = 0, l = r.length; i < l; i ++ ) {

			const ref = r[ i ];
			const diff = a[ i ] - ref;
			relMse += diff * diff / ( ref * ref + 1e-2 );

			const tmDiff = a[ i ] / ( 1 + a[ i ] ) - ref / ( 1 + ref );
			tmSe += tmDiff * tmDiff;
			count ++;

		}

	}

	return { relMse: relMse / count, tmRmse: Math.sqrt( tmSe / count ) };

}

async function run( options = {} ) {

	log( `running ${ JSON.stringify( options ) }` );
	const { elapsed, samples, profile } = await render( options );
	const image = await readImage();
	const error = referenceImage ? computeError( image ) : null;

	const result = {
		label: options.label ?? JSON.stringify( options ),
		elapsedMs: Math.round( elapsed ),
		complete: pathTracer.complete,
		avgSamples: + samples.avg.toFixed( 2 ),
		minSamples: samples.min,
		maxSamples: samples.max,
		samplesPerSecond: Math.round( samples.samplesPerSecond ),
		relMse: error ? + error.relMse.toExponential( 3 ) : null,
		tmRmse: error ? + error.tmRmse.toExponential( 3 ) : null,
		timeline: options.timeline ? timeline : undefined,
		profile,
	};

	log( JSON.stringify( result, null, 1 ) );
	return result;

}

// The exact sRGB to linear transfer the shaders decode with
function srgbToLinear( c ) {

	return c <= 0.04045 ? c / 12.92 : Math.pow( ( c + 0.055 ) / 1.055, 2.4 );

}

// Packs a ramp of every 8 bit sRGB value into an atlas, reads the atlas back, and decodes it the way the
// shaders do. Reports how far the linear values the path tracer sees are from the exact ones, and how
// many of the 64 darkest sRGB levels survive as distinct values. A data ( non color ) ramp is packed
// alongside, which must come through unchanged.
async function atlasPrecision() {

	const width = 256;
	const ramp = new Uint8Array( width * 4 * 4 );
	for ( let i = 0; i < width * 4; i ++ ) {

		const v = i % width;
		ramp.set( [ v, v, v, 255 ], i * 4 );

	}

	const colorTexture = new DataTexture( ramp, width, 4 );
	colorTexture.colorSpace = SRGBColorSpace;
	colorTexture.needsUpdate = true;

	const dataTexture = new DataTexture( ramp.slice(), width, 4 );
	dataTexture.colorSpace = NoColorSpace;
	dataTexture.needsUpdate = true;

	const atlas = new AtlasTexture();
	atlas.setTextures( renderer, [ colorTexture, dataTexture ] );

	const results = {};
	const names = [ 'color', 'data' ];
	for ( let t = 0; t < 2; t ++ ) {

		const info = atlas.textureInfo[ t ];
		const x0 = info.x & 0xFFFF;
		const y0 = info.x >>> 16;
		const page = info.z & 0xFFFF;
		const isSRGB = ( info.w & 1 ) !== 0;
		const pixels = new Uint8Array( await renderer.backend.copyTextureToBuffer( atlas.texture, 0, 0, atlas.width, atlas.height, page ) );

		let maxError = 0;
		let darkRelError = 0;
		const darkLevels = new Set();
		for ( let v = 0; v < width; v ++ ) {

			const stored = pixels[ ( ( y0 + 1 ) * atlas.width + x0 + v ) * 4 ] / 255;
			const seen = isSRGB ? srgbToLinear( stored ) : stored;
			const exact = t === 0 ? srgbToLinear( v / 255 ) : v / 255;
			maxError = Math.max( maxError, Math.abs( seen - exact ) );
			if ( v >= 1 && v < 64 ) {

				darkRelError += Math.abs( seen - exact ) / exact / 63;

			}

			if ( v < 64 ) {

				darkLevels.add( seen );

			}

		}

		results[ names[ t ] ] = {
			maxAbsError: + maxError.toExponential( 3 ),
			darkMeanRelError: + darkRelError.toFixed( 4 ),
			distinctDarkLevels: darkLevels.size,
		};

	}

	atlas.dispose();
	colorTexture.dispose();
	dataTexture.dispose();
	results.workingColorSpace = ColorManagement.workingColorSpace;
	return results;

}
