import { PerspectiveCamera, Scene, Vector2, Clock, NormalBlending, NoBlending, AdditiveBlending } from 'three';
import { PathTracingSceneGenerator } from './PathTracingSceneGenerator.js';
import { PathTracingRenderer } from './PathTracingRenderer.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GradientEquirectTexture } from '../textures/GradientEquirectTexture.js';
import { getIesTextures, getLights, getTextures } from './utils/sceneUpdateUtils.js';
import { ClampedInterpolationMaterial } from '../materials/fullscreen/ClampedInterpolationMaterial.js';
import { CubeToEquirectGenerator } from '../utils/CubeToEquirectGenerator.js';

function supportsFloatBlending( renderer ) {

	return renderer.extensions.get( 'EXT_float_blend' );

}

const _resolution = new Vector2();
export class WebGLPathTracer {

	get multipleImportanceSampling() {

		return Boolean( this._pathTracer.material.defines.FEATURE_MIS );

	}

	set multipleImportanceSampling( v ) {

		this._pathTracer.material.setDefine( 'FEATURE_MIS', v ? 1 : 0 );

	}

	get transmissiveBounces() {

		return this._pathTracer.material.transmissiveBounces;

	}

	set transmissiveBounces( v ) {

		this._pathTracer.material.transmissiveBounces = v;

	}

	get bounces() {

		return this._pathTracer.material.bounces;

	}

	set bounces( v ) {

		this._pathTracer.material.bounces = v;

	}

	get filterGlossyFactor() {

		return this._pathTracer.material.filterGlossyFactor;

	}

	set filterGlossyFactor( v ) {

		this._pathTracer.material.filterGlossyFactor = v;

	}

	get samples() {

		return this._pathTracer.samples;

	}

	get target() {

		return this._pathTracer.target;

	}

	get tiles() {

		return this._pathTracer.tiles;

	}

	get stableNoise() {

		return this._pathTracer.stableNoise;

	}

	set stableNoise( v ) {

		this._pathTracer.stableNoise = v;

	}

	get isCompiling() {

		return Boolean( this._pathTracer.isCompiling );

	}

	constructor( renderer ) {

		// members
		this._renderer = renderer;
		this._generator = new PathTracingSceneGenerator();
		this._pathTracer = new PathTracingRenderer( renderer );
		this._queueReset = false;
		this._clock = new Clock();
		this._compilePromise = null;

		this._lowResPathTracer = new PathTracingRenderer( renderer );
		this._lowResPathTracer.tiles.set( 1, 1 );
		this._quad = new FullScreenQuad( new ClampedInterpolationMaterial( {
			map: null,
			transparent: true,
			blending: NoBlending,

			premultipliedAlpha: renderer.getContextAttributes().premultipliedAlpha,
		} ) );
		this._materials = null;

		this._previousEnvironment = null;
		this._previousBackground = null;
		this._internalBackground = null;

		// options
		this.renderDelay = 100;
		this.minSamples = 5;
		this.fadeDuration = 500;
		this.enablePathTracing = true;
		this.pausePathTracing = false;
		this.dynamicLowRes = false;
		this.lowResScale = 0.25;
		this.renderScale = 1;
		this.synchronizeRenderSize = true;
		this.rasterizeScene = true;
		this.renderToCanvas = true;
		this.textureSize = new Vector2( 1024, 1024 );
		this.rasterizeSceneCallback = ( scene, camera ) => {

			this._renderer.render( scene, camera );

		};

		this.renderToCanvasCallback = ( target, renderer, quad ) => {

			const currentAutoClear = renderer.autoClear;
			renderer.autoClear = false;
			quad.render( renderer );
			renderer.autoClear = currentAutoClear;

		};

		// initialize the scene so it doesn't fail
		this.setScene( new Scene(), new PerspectiveCamera() );

	}

	setBVHWorker( worker ) {

		this._generator.setBVHWorker( worker );

	}

	setScene( scene, camera, options = {} ) {

		scene.updateMatrixWorld( true );
		camera.updateMatrixWorld();

		const generator = this._generator;
		generator.setObjects( scene );

		if ( this._buildAsync ) {

			return generator.generateAsync( options.onProgress ).then( result => {

				return this._updateFromResults( scene, camera, result );

			} );

		} else {

			const result = generator.generate();
			return this._updateFromResults( scene, camera, result );

		}

	}

	setSceneAsync( ...args ) {

		this._buildAsync = true;
		const result = this.setScene( ...args );
		this._buildAsync = false;

		return result;

	}

	setCamera( camera ) {

		this.camera = camera;
		this.updateCamera();

	}

	updateCamera() {

		const camera = this.camera;
		camera.updateMatrixWorld();

		this._pathTracer.setCamera( camera );
		this._lowResPathTracer.setCamera( camera );
		this.reset();

	}

	updateMaterials() {

		const material = this._pathTracer.material;
		const renderer = this._renderer;
		const materials = this._materials;
		const textureSize = this.textureSize;

		// reduce texture sources here - we don't want to do this in the
		// textures array because we need to pass the textures array into the
		// material target
		const textures = getTextures( materials );
		material.textures.setTextures( renderer, textures, textureSize.x, textureSize.y );
		material.materials.updateFrom( materials, textures );
		this.reset();

	}

	updateLights() {

		const scene = this.scene;
		const renderer = this._renderer;
		const material = this._pathTracer.material;

		const lights = getLights( scene );
		const iesTextures = getIesTextures( lights );
		material.lights.updateFrom( lights, iesTextures );
		material.iesProfiles.setTextures( renderer, iesTextures );
		this.reset();

	}

	updateEnvironment() {

		const scene = this.scene;
		const material = this._pathTracer.material;

		if ( this._internalBackground ) {

			this._internalBackground.dispose();
			this._internalBackground = null;

		}

		// update scene background
		material.backgroundBlur = scene.backgroundBlurriness;
		material.backgroundIntensity = scene.backgroundIntensity ?? 1;
		material.backgroundRotation.makeRotationFromEuler( scene.backgroundRotation ).invert();
		if ( scene.background === null ) {

			material.backgroundMap = null;
			material.backgroundAlpha = 0;

		} else if ( scene.background.isColor ) {

			this._colorBackground = this._colorBackground || new GradientEquirectTexture( 16 );

			const colorBackground = this._colorBackground;
			if ( ! colorBackground.topColor.equals( scene.background ) ) {

				// set the texture color
				colorBackground.topColor.set( scene.background );
				colorBackground.bottomColor.set( scene.background );
				colorBackground.update();

			}

			// assign to material
			material.backgroundMap = colorBackground;
			material.backgroundAlpha = 1;

		} else if ( scene.background.isCubeTexture ) {

			if ( scene.background !== this._previousBackground ) {

				const background = new CubeToEquirectGenerator( this._renderer ).generate( scene.background );
				this._internalBackground = background;
				material.backgroundMap = background;
				material.backgroundAlpha = 1;

			}

		} else {

			material.backgroundMap = scene.background;
			material.backgroundAlpha = 1;

		}

		// update scene environment
		material.environmentIntensity = scene.environment !== null ? ( scene.environmentIntensity ?? 1 ) : 0;
		material.environmentRotation.makeRotationFromEuler( scene.environmentRotation ).invert();
		if ( this._previousEnvironment !== scene.environment ) {

			if ( scene.environment !== null ) {

				if ( scene.environment.isCubeTexture ) {

					const environment = new CubeToEquirectGenerator( this._renderer ).generate( scene.environment );
					material.envMapInfo.updateFrom( environment );

				} else {

					// TODO: Consider setting this to the highest supported bit depth by checking for
					// OES_texture_float_linear or OES_texture_half_float_linear. Requires changes to
					// the equirect uniform
					material.envMapInfo.updateFrom( scene.environment );

				}

			}

		}

		this._previousEnvironment = scene.environment;
		this._previousBackground = scene.background;
		this.reset();

	}

	_updateFromResults( scene, camera, results ) {

		const {
			materials,
			geometry,
			bvh,
			bvhChanged,
			needsMaterialIndexUpdate,
		} = results;

		this._materials = materials;

		const pathTracer = this._pathTracer;
		const material = pathTracer.material;

		if ( bvhChanged ) {

			material.bvh.updateFrom( bvh );
			material.attributesArray.updateFrom(
				geometry.attributes.normal,
				geometry.attributes.tangent,
				geometry.attributes.uv,
				geometry.attributes.color,
			);

		}

		if ( needsMaterialIndexUpdate ) {

			material.materialIndexAttribute.updateFrom( geometry.attributes.materialIndex );

		}

		// save previously used items
		this._previousScene = scene;
		this.scene = scene;
		this.camera = camera;

		this.updateCamera();
		this.updateMaterials();
		this.updateEnvironment();
		this.updateLights();

		return results;

	}

	renderSample() {

		const lowResPathTracer = this._lowResPathTracer;
		const pathTracer = this._pathTracer;
		const renderer = this._renderer;
		const clock = this._clock;
		const quad = this._quad;

		this._updateScale();

		if ( this._queueReset ) {

			pathTracer.reset();
			lowResPathTracer.reset();
			this._queueReset = false;

			quad.material.opacity = 0;
			clock.start();

		}

		// render the path tracing sample after enough time has passed
		const delta = clock.getDelta() * 1e3;
		const elapsedTime = clock.getElapsedTime() * 1e3;
		if ( ! this.pausePathTracing && this.enablePathTracing && this.renderDelay <= elapsedTime && ! this.isCompiling ) {

			pathTracer.update();

		}

		// when alpha is enabled we use a manual blending system rather than
		// rendering with a blend function
		pathTracer.alpha = pathTracer.material.backgroundAlpha !== 1 || ! supportsFloatBlending( renderer );
		lowResPathTracer.alpha = pathTracer.alpha;

		if ( this.renderToCanvas ) {

			const renderer = this._renderer;
			const minSamples = this.minSamples;

			if ( elapsedTime >= this.renderDelay && this.samples >= this.minSamples ) {

				if ( this.fadeDuration !== 0 ) {

					quad.material.opacity = Math.min( quad.material.opacity + delta / this.fadeDuration, 1 );

				} else {

					quad.material.opacity = 1;

				}

			}

			// render the fallback if we haven't rendered enough samples, are paused, or are occluded
			if ( ! this.enablePathTracing || this.samples < minSamples || quad.material.opacity < 1 ) {

				if ( this.dynamicLowRes && ! this.isCompiling ) {

					if ( lowResPathTracer.samples < 1 ) {

						lowResPathTracer.material = pathTracer.material;
						lowResPathTracer.update();

					}

					const currentOpacity = quad.material.opacity;
					quad.material.opacity = 1 - quad.material.opacity;
					quad.material.map = lowResPathTracer.target.texture;
					quad.render( renderer );
					quad.material.opacity = currentOpacity;

				}

				if ( ! this.dynamicLowRes && this.rasterizeScene || this.dynamicLowRes && this.isCompiling ) {

					this.rasterizeSceneCallback( this.scene, this.camera );

				}

			}


			if ( this.enablePathTracing && quad.material.opacity > 0 ) {

				if ( quad.material.opacity < 1 ) {

					// use additive blending when the low res texture is rendered so we can fade the
					// background out while the full res fades in
					quad.material.blending = this.dynamicLowRes ? AdditiveBlending : NormalBlending;

				}

				quad.material.map = pathTracer.target.texture;
				this.renderToCanvasCallback( pathTracer.target, renderer, quad );
				quad.material.blending = NoBlending;

			}

		}

	}

	reset() {

		this._queueReset = true;
		this._pathTracer.samples = 0;

	}

	dispose() {

		this._quad.dispose();
		this._quad.material.dispose();
		this._pathTracer.dispose();

	}

	_updateScale() {

		// update the path tracer scale if it has changed
		if ( this.synchronizeRenderSize ) {

			this._renderer.getDrawingBufferSize( _resolution );

			const w = Math.floor( this.renderScale * _resolution.x );
			const h = Math.floor( this.renderScale * _resolution.y );

			this._pathTracer.getSize( _resolution );
			if ( _resolution.x !== w || _resolution.y !== h ) {

				const lowResScale = this.lowResScale;
				this._pathTracer.setSize( w, h );
				this._lowResPathTracer.setSize( Math.floor( w * lowResScale ), Math.floor( h * lowResScale ) );

			}

		}

	}

}
