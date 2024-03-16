import { Color, CustomBlending, Matrix4, MeshBasicMaterial, Vector2, WebGLRenderer } from 'three';
import { DynamicPathTracingSceneGenerator } from './DynamicPathTracingSceneGenerator.js';
import { PathTracingRenderer } from './PathTracingRenderer.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GradientEquirectTexture } from '../textures/GradientEquirectTexture.js';

const _resolution = new Vector2();
const _flipEnvMap = new Matrix4().makeScale( - 1, 1, 1 );
const _color = new Color();

export class WebGLPathTracer {

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

		} else {

			this._ownRenderer = false;

		}

		// members
		this._renderer = renderer;
		this._generator = null;
		this._pathTracer = new PathTracingRenderer( renderer );
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

			this._renderer.render( this.scene, this.camera );

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
			'getClearAlpha',
			'setClearAlpha',
			'getClearColor',
			'setClearColor',
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

		// update scene information
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
		material.backgroundBlur = scene.backgroundBlurriness;
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
			material.background = colorBackground;
			material.backgroundAlpha = alpha;

		} else {

			material.background = scene.background;

		}

		// update scene environment
		material.environmentIntensity = scene.environmentIntensity || 1;
		material.environmentRotation.makeRotationFromEuler( scene.environmentRotation ).multiply( _flipEnvMap );
		if ( this._previousEnvironment !== scene.environment ) {

			if ( scene.environment ) {

				material.envMapInfo.updateFrom( scene.environment );

			} else {

				material.environmentIntensity = 0;

			}

		}

		// camera update
		pathTracer.camera = camera;

		// save previously used items
		this._previousScene = scene;
		this._previousEnvironment = scene.environment;
		this.scene = scene;
		this.camera = camera;

		this.reset();

	}

	renderSample() {

		this._updateScale();

		const pathTracer = this._pathTracer;
		pathTracer.update();

		if ( this.renderToCanvas ) {

			this.renderSceneCallback();

			// const renderer = this._renderer;
			// const quad = this._quad;
			// quad.material.map = pathTracer.target.texture;
			// quad.render( renderer );

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
			const h = Math.floor( this.renderScale * _resolution.y );

			this._pathTracer.getSize( _resolution );
			if ( _resolution.x !== w || _resolution.y !== h ) {

				this._pathTracer.setSize( w, h );

			}

		}

	}

}
