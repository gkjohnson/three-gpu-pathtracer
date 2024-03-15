import { CustomBlending, Matrix4, MeshBasicMaterial, Vector2, WebGLRenderer } from 'three';
import { DynamicPathTracingSceneGenerator } from './DynamicPathTracingSceneGenerator.js';
import { PathTracingRenderer } from './PathTracingRenderer.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GradientEquirectTexture } from '../textures/GradientEquirectTexture.js';

const _resolution = new Vector2();
const _flipEnvMap = new Matrix4().makeScale( - 1, 1, 1 );

export class WebGLPathTracer {

	get filterGlossyFactor() {

		return this._pathTracer.filterGlossyFactor;

	}

	get filterGlossyFactor() {

		return this._pathTracer.filterGlossyFactor;

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

	constructor( renderer = null ) {

		if ( renderer === null ) {

			renderer = new WebGLRenderer( { alpha: true } );
			this._ownRenderer = true;

		} else {

			this._ownRenderer = false;

		}

		this._renderer = renderer;
		this._generator = new DynamicPathTracingSceneGenerator();
		this._pathTracer = new PathTracingRenderer();
		this._quad = new FullScreenQuad( new MeshBasicMaterial( {
			map: null,
			blending: CustomBlending,
			premultipliedAlpha: renderer.getContextAttributes().premultipliedAlpha,
		} ) );

		this.renderScale = 1;
		this.synchronizeRenderSize = true;
		this.renderToCanvas = true;
		this.textureSize = new Vector2( 1024, 1024 );
		this.renderSceneCallback = () => {

			this._renderer.render( this.camera, this.scene );

		};

		// pass through functions for the canvas
		[
			'getPixelRatio',
			'setPixelRatio',
			'getSize',
			'setSize',
			'setViewport',
			'getViewport',
			'getScissor',
			'setScissor',
			'getScissorTest',
			'setScissorTest',
			'setDrawingBufferSize',
			'getDrawingBufferSize',
		].forEach( key => {

			this[ key ] = ( ...args ) => this._renderer[ key ]( ...args );

		} );

	}

	updateScene( camera, scene ) {

		const renderer = this._renderer;
		const pathTracer = this._pathTracer;
		const material = pathTracer.material;

		// TODO: adjust this so we don't have to create a new tracer every time and the
		// geometry results automatically expands to fit results
		if ( scene !== this._previousScene ) {

			this.generator = new DynamicPathTracingSceneGenerator( scene );

		}

		// set up
		const {
			lights,
			materials,
			textures,
			geometry,
			bvh,
		} = this.generator.generate();

		material.lights.updateFrom( lights );
		material.bvh.updateFrom( bvh );
		material.attributesArray.updateFrom(
			geometry.attributes.normal,
			geometry.attributes.tangent,
			geometry.attributes.uv,
			geometry.attributes.color,
		);
		material.materialIndexAttribute.updateFrom( geometry.attributes.materialIndex );
		material.textures.setTextures( renderer, this.textureSize.x, this.textureSize.y, textures );
		material.materials.updateFrom( materials, textures );

		// update scene background
		// material.backgroundRotation
		// material.backgroundIntensity
		material.backgroundBlur = scene.backgroundBlurriness;
		if ( scene.background && scene.background.isColor ) {

			this._colorBackground = this._colorBackground || new GradientEquirectTexture( 16 );
			this._colorBackground.topColor.set( scene.background );
			this._colorBackground.bottomColor.set( scene.background );
			this._colorBackground.update();

			material.background = this._colorBackground;

		} else {

			material.background = scene.background;

		}

		// update scene environment
		material.environmentIntensity = scene.environmentIntensity || 1;
		material.environmentRotation.makeRotationFromEuler( scene.environmentRotation ).multiply( _flipEnvMap );
		if ( this._previousEnvironment !== scene.environment ) {

			material.envMapInfo.updateFrom( scene.environment );

		}

		// camera update
		pathTracer.camera = camera;

		// save
		this._previousScene = scene;
		this._previousBackground = scene.background;
		this._previousEnvironment = scene.environment;

		this.reset();

	}

	renderSample() {

		this._updateScale();

		const pathTracer = this._pathTracer;
		pathTracer.update();

		if ( this.renderToCanvas ) {

			const renderer = this._renderer;
			const quad = this._renderQuad;
			quad.material.map = pathTracer.target;
			quad.render( renderer );

		}

	}

	reset() {

		this._pathTracer.reset();

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
			const h = Math.floor( this.renderScale * _resolution.h );

			this._pathTracer.getSize( _resolution );
			if ( _resolution.x !== w || _resolution.y !== h ) {

				this._pathTracer.setSize( w, h );

			}

		}

	}

}
