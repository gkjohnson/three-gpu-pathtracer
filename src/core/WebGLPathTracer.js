import { Color, CustomBlending, MeshBasicMaterial, PerspectiveCamera, Scene, Vector2, WebGLRenderer } from 'three';
import { PathTracingSceneGenerator } from './PathTracingSceneGenerator.js';
import { PathTracingRenderer } from './PathTracingRenderer.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GradientEquirectTexture } from '../textures/GradientEquirectTexture.js';

const _resolution = new Vector2();
const _color = new Color();

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

	get domElement() {

		return this._renderer.domElement;

	}

	get alpha() {

		return this._pathTracer.alpha;

	}

	set alpha( v ) {

		this._pathTracer.alpha = v;

	}

	get toneMapping() {

		return this._renderer.toneMapping;

	}

	set toneMapping( v ) {

		this._renderer.toneMapping = v;

	}

	constructor( renderer = null ) {

		// create a new renderer if one was not provided
		if ( renderer === null ) {

			renderer = new WebGLRenderer( { alpha: true } );
			this._ownRenderer = true;

		} else if ( renderer.isWebGLRenderer ) {

			this._ownRenderer = false;

		} else {

			renderer = new WebGLRenderer( { ...renderer, alpha: true } );
			this._ownRenderer = true;

		}

		// members
		this._renderer = renderer;
		this._generator = new PathTracingSceneGenerator();
		this._pathTracer = new PathTracingRenderer( renderer );
		this._pathTracer.alpha = renderer.getContextAttributes().alpha;

		this._lowResPathTracer = new PathTracingRenderer( renderer );
		this._quad = new FullScreenQuad( new MeshBasicMaterial( {
			map: null,
			blending: CustomBlending,
			premultipliedAlpha: renderer.getContextAttributes().premultipliedAlpha,
		} ) );

		// options
		this.enablePathTracing = true;
		this.pausePathTracing = false;
		this.dynamicLowRes = false;
		this.lowResScale = 0.15;
		this.renderScale = 1;
		this.synchronizeRenderSize = true;
		this.rasterizeScene = true;
		this.renderToCanvas = true;
		this.textureSize = new Vector2( 1024, 1024 );
		this.rasterizeSceneCallback = ( scene, camera ) => {

			this._renderer.render( scene, camera );

		};

		this.renderToCanvasCallback = ( target, renderer, quad ) => {

			const autoClear = renderer.autoClear;
			renderer.autoClear = false;
			quad.material.map = target.texture;
			quad.render( renderer );
			renderer.autoClear = autoClear;

		};

		// pass through functions for the canvas
		[
			'getPixelRatio',
			'setPixelRatio',
			'setDrawingBufferSize',
			'getDrawingBufferSize',
			'getSize',
			'setSize',
		].forEach( key => {

			this[ key ] = ( ...args ) => {

				this._renderer[ key ]( ...args );
				if ( this.renderToCanvas ) {

					this.reset();

				}

			};

		} );

		// Functions that require always resetting the render
		[
			'setViewport',
			'getViewport',
			'getScissor',
			'setScissor',
			'getScissorTest',
			'setScissorTest',
			'getClearAlpha',
			'setClearAlpha',
			'getClearColor',
			'setClearColor',
		].forEach( key => {

			this[ key ] = ( ...args ) => {

				this._renderer[ key ]( ...args );
				this.reset();

			};

		} );

		// initialize the scene so it doesn't fail
		this.updateScene( new PerspectiveCamera(), new Scene() );

	}

	setBVHWorker( worker ) {

		this._generator.setBVHWorker( worker );

	}

	updateScene( camera, scene, options = {} ) {

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

	updateSceneAsync( ...args ) {

		this._buildAsync = true;
		const result = this.updateScene( ...args );
		this._buildAsync = false;

		return result;

	}

	_updateFromResults( scene, camera, results ) {

		const {
			lights,
			iesTextures,
			materials,
			textures,
			geometry,
			bvh,
			bvhChanged,
		} = results;

		const renderer = this._renderer;
		const pathTracer = this._pathTracer;
		const lowResPathTracer = this._lowResPathTracer;
		const material = pathTracer.material;
		const textureSize = this.textureSize;

		// update scene information
		material.lights.updateFrom( lights, iesTextures );
		material.iesProfiles.updateFrom( renderer, iesTextures );
		material.lightCount = lights.length;
		material.textures.setTextures( renderer, textureSize.x, textureSize.y, textures );
		material.materials.updateFrom( materials, textures );

		if ( bvhChanged ) {

			material.bvh.updateFrom( bvh );
			material.attributesArray.updateFrom(
				geometry.attributes.normal,
				geometry.attributes.tangent,
				geometry.attributes.uv,
				geometry.attributes.color,
			);

			material.materialIndexAttribute.updateFrom( geometry.attributes.materialIndex );

		}

		// update scene background
		material.backgroundBlur = scene.backgroundBlurriness;
		material.backgroundIntensity = scene.backgroundIntensity ?? 1;
		material.backgroundRotation.makeRotationFromEuler( scene.backgroundRotation ).invert();
		if ( scene.background === null || scene.background && scene.background.isColor ) {

			this._colorBackground = this._colorBackground || new GradientEquirectTexture( 16 );

			// get the background color from scene or renderer
			let alpha;
			if ( scene.background ) {

				_color.copy( scene.background );
				alpha = 1;

			} else {

				renderer.getClearColor( _color );
				alpha = renderer.getClearAlpha();

			}

			// set the texture color
			const colorBackground = this._colorBackground;
			colorBackground.topColor.set( _color );
			colorBackground.bottomColor.set( _color );
			colorBackground.update();

			// assign to material
			material.backgroundMap = colorBackground;
			material.backgroundAlpha = alpha;

		} else {

			material.backgroundMap = scene.background;
			material.backgroundAlpha = 1;

		}

		// update scene environment
		material.environmentIntensity = scene.environmentIntensity ?? 1;
		material.environmentRotation.makeRotationFromEuler( scene.environmentRotation ).invert();
		if ( this._previousEnvironment !== scene.environment ) {

			if ( scene.environment ) {

				material.envMapInfo.updateFrom( scene.environment );

			} else {

				material.environmentIntensity = 0;

			}

		}

		// camera update
		// TODO: these cameras should only be set once so we don't depend on movement
		pathTracer.camera = camera;
		lowResPathTracer.camera = camera;
		lowResPathTracer.material = pathTracer.material;

		// save previously used items
		this._previousScene = scene;
		this._previousEnvironment = scene.environment;
		this.scene = scene;
		this.camera = camera;

		this.reset();

		return results;

	}

	renderSample() {

		this._updateScale();

		const lowResPathTracer = this._lowResPathTracer;
		const pathTracer = this._pathTracer;
		if ( ! this.pausePathTracing && this.enablePathTracing ) {

			pathTracer.update();

		}

		if ( this.renderToCanvas ) {

			const renderer = this._renderer;
			const quad = this._quad;
			if ( this.dynamicLowRes ) {

				if ( lowResPathTracer.samples < 1 ) {

					lowResPathTracer.update();

				}

				quad.material.map = lowResPathTracer.target.texture;
				quad.render( renderer );

			} else if ( this.samples < 1 && this.rasterizeScene ) {

				this.rasterizeSceneCallback( this.scene, this.camera );

			}

			if ( this.enablePathTracing ) {

				this.renderToCanvasCallback( pathTracer.target, renderer, quad );

			}

		}

	}

	reset() {

		this._pathTracer.reset();
		this._lowResPathTracer.reset();

	}

	dispose() {

		this._renderQuad.dispose();
		this._renderQuad.material.dispose();
		this._pathTracer.dispose();

		if ( this._ownRenderer ) {

			this.renderer.dispose();

		}

	}

	_updateScale() {

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
