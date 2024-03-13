import { CustomBlending, MeshBasicMaterial, WebGLRenderer } from 'three';
import { DynamicPathTracingSceneGenerator } from './DynamicPathTracingSceneGenerator.js';
import { PathTracingRenderer } from './PathTracingRenderer.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass';

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

		this.renderSceneCallback = () => {

			this._renderer.render( this.camera, this.scene );

		};

		// pass through functions for the canvas
		// TODO: how do we deal with setting the buffer size separately from the canvas?
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

		} );

		// TODO: pass through fields for the path tracer
		[
			'filterGlossyFactor',
			'alpha',
			'tiles',
		].forEach( key => {

		} );

	}

	updateScene( camera, scene, options = {} ) {

		options = {
			updateGeometry: true,
			updateMaterials: true,
			updateTextures: true,
			updateLights: true,
			updateCamera: true,
			updateEnvironment: true,
			...options,
		};

		const generator = this._generator;
		const pathTracer = this._pathTracer;
		const material = pathTracer.material;

	}

	renderSample() {

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

}
