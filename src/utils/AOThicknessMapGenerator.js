import * as THREE from 'three';
import { MeshBVHUniformStruct } from 'three-mesh-bvh';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UVTriangleDataTextureGenerator } from './UVTriangleDataTextureGenerator.js';
import { AOThicknessMode, AOThicknessMaterial } from '../materials/surface/AOThicknessMaterial.js';
import { MipFlooder } from './MipFlooder.js';
import { UVEdgeExpander } from './UVEdgeExpander.js';
import { PathTracingSceneGenerator } from '../core/PathTracingSceneGenerator.js';

export const AO_THICKNESS_SAMPLES_PER_UPDATE = 10;

export class AOThicknessMapGenerator {

	constructor( renderer ) {

		this._renderer = renderer;
		this.channel = 1;
		this.samples = 100;
		this.flood = true;
		this.mode = AOThicknessMode.AO_AND_THICKNESS;
		this.aoRadius = 1.0;
		this.thicknessRadius = 1.0;

		this._generator = null;
		this._isGenerating = false;

	}

	startGeneration( geometries, renderTarget ) {

		if ( this._isGenerating ) {

			throw new Error( 'Generation already in progress' );

		}

		this._isGenerating = true;
		this._generator = this._generateIterator( geometries, renderTarget );

	}

	generateSample() {

		if ( ! this._isGenerating || ! this._generator ) {

			return false;

		}

		const renderer = this._renderer;
		const originalRenderTarget = renderer.getRenderTarget();
		const originalRenderAutoClear = renderer.autoClear;
		const originalAutoClear = renderer.autoClear;
		const originalPixelRatio = renderer.getPixelRatio();
		const originalClearColor = new THREE.Color();
		renderer.getClearColor( originalClearColor );

		try {

			const result = this._generator.next();

			if ( result.done ) {

				this._isGenerating = false;
				this._generator = null;
				return false;

			}

			return true;

		} finally {

			renderer.setClearColor( originalClearColor );
			renderer.setRenderTarget( originalRenderTarget );
			renderer.autoClear = originalRenderAutoClear;
			renderer.setPixelRatio( originalPixelRatio );
			renderer.autoClear = originalAutoClear;

		}

	}

	*_generateIterator( geometries, renderTarget ) {

		if ( geometries.constructor !== Array ) {

			geometries = [ geometries ];

		}

		const { _renderer: renderer, channel, samples, flood, mode, thicknessRadius, aoRadius } = this;

		renderer.setClearColor( 0x000000, 0 );

		renderer.autoClear = false;
		renderer.setPixelRatio( 1 );

		const aoRenderTarget = new THREE.WebGLRenderTarget( renderTarget.width, renderTarget.height, {
			type: THREE.FloatType,
			colorSpace: renderTarget.colorSpace
		} );

		renderer.setRenderTarget( renderTarget );
		renderer.clear();

		const copyQuad = new FullScreenQuad( new THREE.MeshBasicMaterial( { transparent: true } ) );

		// scale the scene to a reasonable size
		const scene = new THREE.Scene();
		const group = new THREE.Group();

		for ( const geometry of geometries ) {

			group.add( new THREE.Mesh( geometry, new THREE.MeshBasicMaterial() ) );

		}

		scene.add( group );

		const box = new THREE.Box3();
		box.setFromObject( scene );

		const sphere = new THREE.Sphere();
		box.getBoundingSphere( sphere );

		scene.scale.setScalar( 2.5 / sphere.radius );
		scene.position.y = - 0.25 * ( box.max.y - box.min.y ) * 2.5 / sphere.radius;
		scene.updateMatrixWorld();

		const { bvh } = new PathTracingSceneGenerator( group ).generate();

		const uvTriangleDataTextureGenerator = new UVTriangleDataTextureGenerator( renderer );
		uvTriangleDataTextureGenerator.channel = channel;
		const uvToTriangleMap = uvTriangleDataTextureGenerator.generateTexture( geometries, renderTarget.width );

		const bvhUniform = new MeshBVHUniformStruct();
		bvhUniform.updateFrom( bvh );

		const material = new AOThicknessMaterial( {
			mode,
			bvh: bvhUniform,
			objectModelMatrix: scene.matrixWorld, // new THREE.Matrix4(),
			uvToTriangleMap: uvToTriangleMap,
			resolution: new THREE.Vector2( renderTarget.width, renderTarget.height ),
			thicknessRadius,
			aoRadius
		} );

		const aoQuad = new FullScreenQuad( material );
		copyQuad.material.map = aoRenderTarget.texture;

		let steps = 1;

		for ( let i = 0; i < samples; i += AO_THICKNESS_SAMPLES_PER_UPDATE ) {

			renderer.setPixelRatio( 1 );
			renderer.setRenderTarget( aoRenderTarget );
			renderer.setClearColor( 0x000000, 0 );
			renderer.autoClear = false;
			renderer.clear();

			material.seed ++;
			aoQuad.render( renderer );
			renderer.setRenderTarget( renderTarget );
			copyQuad.material.map.needsUpdate = true;
			copyQuad.material.opacity = 1 / steps;
			copyQuad.render( renderer );
			steps ++;

			yield;

		}

		uvToTriangleMap.dispose();
		material.dispose();
		aoQuad.dispose();

		if ( flood ) {

			const expandTarget = new THREE.WebGLRenderTarget( renderTarget.width, renderTarget.height, {
				minFilter: THREE.NearestFilter,
				magFilter: THREE.NearestFilter,
				format: THREE.RGBAFormat,
				type: THREE.FloatType
			} );

			const floodTarget = new THREE.WebGLRenderTarget( renderTarget.width, renderTarget.height, {
				minFilter: THREE.NearestFilter,
				magFilter: THREE.NearestFilter,
				format: THREE.RGBAFormat,
				type: THREE.FloatType
			} );

			const mipFlooder = new MipFlooder( renderer );
			const edgeExpander = new UVEdgeExpander( renderer );

			edgeExpander.expand( renderTarget.texture, expandTarget );
			mipFlooder.floodFill( expandTarget.texture, floodTarget );

			renderer.setRenderTarget( renderTarget );
			copyQuad.material.map = floodTarget.texture;
			copyQuad.material.opacity = 1;
			copyQuad.render( renderer );

			expandTarget.dispose();
			floodTarget.dispose();
			mipFlooder.dispose();
			edgeExpander.dispose();

		}

		copyQuad.dispose();

	}

}
