import { ZeroOutKernel } from './compute/ZeroOutKernel.js';
import { createOutputTarget, createSampleCountTarget } from './compute/targets.js';

export class PathTracerBackend {

	constructor( renderer ) {

		this.renderer = renderer;
		this.maxBounces = 15;

		// how much work a single update dispatches, in path slots. Lower values keep frames
		// responsive on slower hardware; the unit is resolution independent.
		this.frameBudget = 250000;
		this.maxTransparentBounces = 15;
		this.lowResMode = false;

		// stop taking samples once a pixel reaches this count. zero means no limit.
		this.maxSamples = 0;

		this._renderTask = null;
		this._compiledKernels = new WeakSet();

		this.outputTarget = createOutputTarget( 'Output #0' );
		this.prevOutputTarget = createOutputTarget( 'Output #1' );
		this.sampleCountTarget = createSampleCountTarget( 'Sample Count' );

		this.sampleCountClearKernel = new ZeroOutKernel().setWorkgroupSize( 8, 8, 1 );
		this.outputTargetClearKernel = new ZeroOutKernel().setWorkgroupSize( 8, 8, 1 );

	}

	setRandom( random ) {

	}

	setBVHData( data ) {

	}

	setTextures( textures ) {

	}

	setMaterial( material ) {

	}

	setFilterGlossy( value ) {

	}

	setClamping( _direct, _indirect ) {

	}

	setEnvironment(
		envMap,
		envMapIntensity,
		envMapRotation,
	) {

	}

	setLights( lights ) {

	}

	setBackground(
		background,
		backgroundIntensity,
		backgroundRotation,
		backgroundBlurriness,
	) {

	}

	// Compiles the kernels' pipelines asynchronously and yields until they're ready, so the first
	// dispatch doesn't block the main thread on a synchronous pipeline compile. Kernels compiled by an
	// earlier render task are skipped so a reset doesn't wait a frame for nothing.
	*compileKernels( kernels ) {

		const { renderer, _compiledKernels } = this;

		// three.js r185 has no async compute compile, so the pipelines compile on first dispatch
		if ( ! renderer.compileComputeAsync ) {

			return;

		}

		const computeNodes = kernels
			.map( kernel => kernel.kernel )
			.filter( computeNode => ! _compiledKernels.has( computeNode ) );

		if ( computeNodes.length === 0 ) {

			return;

		}

		let complete = false;
		renderer.compileComputeAsync( computeNodes )
			.catch( () => {

				// a failed compile is retried, and reported, by the dispatch

			} )
			.finally( () => {

				computeNodes.forEach( computeNode => _compiledKernels.add( computeNode ) );
				complete = true;

			} );

		while ( ! complete ) {

			yield;

		}

	}

	// Rebuild the render task after a shader-generating function changes.
	rebuild() {

		this._renderTask = null;

	}

	setSize( w, h ) {

		w = Math.ceil( w );
		h = Math.ceil( h );

		const { width, height } = this.outputTarget;
		if ( width === w && height === h ) {

			return false;

		}

		this.outputTarget.dispose();
		this.prevOutputTarget.dispose();
		this.sampleCountTarget.dispose();

		this.outputTarget = this.outputTarget.clone();
		this.prevOutputTarget = this.outputTarget.clone();
		this.sampleCountTarget = this.sampleCountTarget.clone();

		this.outputTarget.setSize( w, h );
		this.prevOutputTarget.setSize( w, h );
		this.sampleCountTarget.setSize( w, h );

		this.reset();
		return true;

	}

	getSize( target ) {

		const { width, height } = this.outputTarget;
		target.x = width;
		target.y = height;

		return target;

	}

	update() {

		const { renderer } = this;
		if ( ! renderer.initialized ) {

			return;

		}

		if ( ! this._renderTask ) {

			this._renderTask = this.createRenderTask();

		}

		this._renderTask.next();

	}

	*createRenderTask() {

	}

	// Measures the current per pixel sample counts. Backends that need GPU work to answer this do
	// it here, so it only happens when asked for rather than every round.
	async getSampleCountsAsync() {

		return { min: 0, max: 0, avg: 0 };

	}

	resetSeed() {}

	reset() {

		const {
			renderer,
			outputTargetClearKernel,
			sampleCountClearKernel,

			outputTarget,
			prevOutputTarget,
			sampleCountTarget,
		} = this;

		if ( ! renderer.initialized ) {

			return;

		}

		const { width, height } = outputTarget;
		const dispatchSize = outputTargetClearKernel.getDispatchSize( width, height );

		outputTargetClearKernel.target = outputTarget;
		renderer.compute( outputTargetClearKernel.kernel, dispatchSize );

		outputTargetClearKernel.target = prevOutputTarget;
		renderer.compute( outputTargetClearKernel.kernel, dispatchSize );

		sampleCountClearKernel.target = sampleCountTarget;
		renderer.compute( sampleCountClearKernel.kernel, dispatchSize );

		this._renderTask = null;

	}

	dispose() {

		this.outputTarget.dispose();
		this.prevOutputTarget.dispose();
		this.sampleCountTarget.dispose();
		this.sampleCountClearKernel.dispose();
		this.outputTargetClearKernel.dispose();

		this._renderTask = null;

	}

}
