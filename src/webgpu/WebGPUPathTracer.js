import {
	Color, StorageBufferAttribute, PerspectiveCamera, Scene,
	Vector2, Clock, NormalBlending, NoBlending, AdditiveBlending, NodeMaterial,
	FrontSide, BackSide, DoubleSide,
} from 'three/webgpu';
import { storage, uniform, wgslFn, uv, varying, positionGeometry } from 'three/tsl';
import { PathTracingSceneGenerator } from '../core/PathTracingSceneGenerator.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GradientEquirectTexture } from '../textures/GradientEquirectTexture.js';
import { getIesTextures, getLights, getTextures } from '../core/utils/sceneUpdateUtils.js';
import { ClampedInterpolationMaterial } from '../materials/fullscreen/ClampedInterpolationMaterial.js';
import { CubeToEquirectGenerator } from '../utils/CubeToEquirectGenerator.js';
import { getTextureHash } from '../core/utils/sceneUpdateUtils.js';
import { PathTracerCore } from './PathTracerCore.js';
import { bufferToHash } from '../utils/bufferToHash.js';

// function supportsFloatBlending( renderer ) {

// 	return renderer.extensions.get( 'EXT_float_blend' );

// }

const MATERIAL_STRIDE = 260;

const _resolution = new Vector2();
export class WebGPUPathTracer {

	// get multipleImportanceSampling() {

	// 	return Boolean( this._pathTracer.material.defines.FEATURE_MIS );

	// }

	// set multipleImportanceSampling( v ) {

	// 	this._pathTracer.material.setDefine( 'FEATURE_MIS', v ? 1 : 0 );

	// }

	// get transmissiveBounces() {

	// 	return this._pathTracer.material.transmissiveBounces;

	// }

	// set transmissiveBounces( v ) {

	// 	this._pathTracer.material.transmissiveBounces = v;

	// }

	get bounces() {

		return this._pathTracer.material.bounces;

	}

	set bounces( v ) {

		this._pathTracer.material.bounces = v;

	}

	// get filterGlossyFactor() {

	// 	return this._pathTracer.material.filterGlossyFactor;

	// }

	// set filterGlossyFactor( v ) {

	// 	this._pathTracer.material.filterGlossyFactor = v;

	// }

	// get samples() {

	// 	return this._pathTracer.samples;

	// }

	// get target() {

	// 	return this._pathTracer.target;

	// }

	// get tiles() {

	// 	return this._pathTracer.tiles;

	// }

	// get stableNoise() {

	// 	return this._pathTracer.stableNoise;

	// }

	// set stableNoise( v ) {

	// 	this._pathTracer.stableNoise = v;

	// }

	get isCompiling() {

		return Boolean( this._pathTracer.isCompiling );

	}

	useMegakernel( value ) {

		this._pathTracer.setUseMegakernel( value );

	}

	constructor( renderer ) {

		// members
		this._renderer = renderer;
		this._generator = new PathTracingSceneGenerator();
		this._pathTracer = new PathTracerCore( renderer );
		this._queueReset = false;
		this._clock = new Clock();
		this._compilePromise = null;

		this.tiles = new Vector2();

		// this._lowResPathTracer = new PathTracingRenderer( renderer );
		// this._lowResPathTracer.tiles.set( 1, 1 );
		// this._quad = new FullScreenQuad( new ClampedInterpolationMaterial( {
		// 	map: null,
		// 	transparent: true,
		// 	blending: NoBlending,

		// 	premultipliedAlpha: renderer.getContextAttributes().premultipliedAlpha,
		// } ) );
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

		const blitMaterial = new NodeMaterial();
		const fragmentShaderParams = {
			resultBuffer: storage( new StorageBufferAttribute(), 'vec4' ),
			dimensions: uniform( new Vector2() ),
			uv: varying( uv() ),
		};

		// TODO: Apply gamma correction?
		this.blitFragmentShader = wgslFn( /* wgsl */ `
			fn blit(
				resultBuffer: ptr<storage, array<vec4f>, read>,
				dimensions: vec2u,
				uv: vec2f,
			) -> vec4f {
				let x = min(u32( uv.x * f32(dimensions.x) ), dimensions.x - 1);
				let y = min(u32( uv.y * f32(dimensions.y) ), dimensions.y - 1);
				let offset = x + y * dimensions.x;
				return resultBuffer[offset];
			}
		` );

		blitMaterial.fragmentNode = this.blitFragmentShader( fragmentShaderParams );

		const vertexShaderParams = {
			position: positionGeometry,
		};
		const fullScreenQuadVertex = wgslFn( /* wgsl */ `
			fn noop(position: vec4f) -> vec4f {
				return position;
			}
		` );
		blitMaterial.vertexNode = fullScreenQuadVertex( vertexShaderParams );

		const blitQuad = new FullScreenQuad( blitMaterial );

		this.renderToCanvasCallback = ( finalBuffer, renderer, quad ) => {

			const blitBuffer = blitQuad.material.fragmentNode.parameters.resultBuffer.value;
			if ( blitBuffer !== finalBuffer ) {

				const fragmentShaderParams = {
					resultBuffer: storage( finalBuffer, 'vec4' ),
					dimensions: uniform( new Vector2() ),
					uv: varying( uv() ),
				};

				blitMaterial.fragmentNode = this.blitFragmentShader( fragmentShaderParams );

			}

			const dimensions = blitQuad.material.fragmentNode.parameters.dimensions.value;
			this._renderer.getSize( dimensions );
			blitQuad.render( renderer );

			// const currentAutoClear = renderer.autoClear;
			// renderer.autoClear = false;
			// quad.render( renderer );
			// renderer.autoClear = currentAutoClear;

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
		// this._lowResPathTracer.setCamera( camera );
		this.reset();

	}

	updateMaterials() {

	}

	updateLights() {

	}

	updateEnvironment() {

	}

	_updateFromResults( scene, camera, results ) {

		const {
			materials,
			geometry,
			bvh,
			bvhChanged,
			needsMaterialIndexUpdate,
		} = results;

		const pathTracer = this._pathTracer;

		const newGeometryData = {};

		if ( bvhChanged ) {

			// dereference a new index attribute if we're using indirect storage
			const dereferencedIndexAttr = geometry.index.clone();
			const indirectBuffer = bvh._indirectBuffer;
			if ( indirectBuffer ) {

				dereferenceIndex( geometry, indirectBuffer, dereferencedIndexAttr );

			}

			const newIndex = new StorageBufferAttribute( dereferencedIndexAttr.array, 3 );
			newIndex.name = 'Geometry Index';
			newGeometryData.index = newIndex;

			const newPosition = new StorageBufferAttribute( geometry.attributes.position.array, 3 );
			newPosition.name = 'Geometry Positions';
			newGeometryData.position = newPosition;

			const newNormals = new StorageBufferAttribute( geometry.attributes.normal.array, 3 );
			newNormals.name = 'Geometry Normals';
			newGeometryData.normal = newNormals;

			const newBvhRoots = new StorageBufferAttribute( new Float32Array( bvh._roots[ 0 ] ), 8 );
			newBvhRoots.name = 'BVH Roots';
			newGeometryData.bvh = newBvhRoots;

		}

		if ( needsMaterialIndexUpdate ) {

			const newMaterialIndex = new StorageBufferAttribute( geometry.attributes.materialIndex.array, 1 );
			newMaterialIndex.name = 'Material Index';
			newGeometryData.materialIndex = newMaterialIndex;

		}

		const newMaterialsData = this.writeMaterialsBuffer( materials, [] );

		const newMaterialsBuffer = new StorageBufferAttribute( newMaterialsData, MATERIAL_STRIDE );
		newMaterialsBuffer.name = 'Material Data';
		newGeometryData.materials = newMaterialsBuffer;

		pathTracer.setGeometryData( newGeometryData );

		this.setCamera( camera );

	}

	writeMaterialsBuffer( materials, textures ) {

		function getTexture( material, key, def = - 1 ) {

			if ( key in material && material[ key ] ) {

				const hash = getTextureHash( material[ key ] );
				return textureLookUp[ hash ];

			} else {

				return def;

			}

		}

		function getField( material, key, def ) {

			return key in material ? material[ key ] : def;

		}

		function writeTextureMatrixToArray( material, textureKey, array, offset ) {

			const texture = material[ textureKey ] && material[ textureKey ].isTexture ? material[ textureKey ] : null;

			// check if texture exists
			if ( texture ) {

				if ( texture.matrixAutoUpdate ) {

					texture.updateMatrix();

				}

				const elements = texture.matrix.elements;

				// Both wgsl struct and elements should be in column-major format
				for ( let i = 0; i < 3; i ++ ) {

					array[ offset + 4 * i + 0 ] = elements[ i + 0 ];
					array[ offset + 4 * i + 1 ] = elements[ i + 1 ];
					array[ offset + 4 * i + 2 ] = elements[ i + 2 ];
					array[ offset + 4 * i + 3 ] = 0; // padding float

				}

			}

			return 12;

		}

		let index = 0;

		// index the list of textures based on shareable source
		const textureLookUp = {};
		for ( let i = 0, l = textures.length; i < l; i ++ ) {

			textureLookUp[ getTextureHash( textures[ i ] ) ] = i;

		}

		const floatArray = new Float32Array( materials.length * MATERIAL_STRIDE );

		// on some devices (Google Pixel 6) the "floatBitsToInt" function does not work correctly so we
		// can't encode texture ids that way.
		// const intArray = new Int32Array( floatArray.buffer );

		// TODO: make features work
		// features.reset();
		console.log( materials[ 0 ].color.r, materials[ 0 ].color.g, materials[ 0 ].color.b );
		for ( let i = 0, l = materials.length; i < l; i ++ ) {

			const m = materials[ i ];

			// if ( m.isFogVolumeMaterial ) {
			//
			// 	// features.setUsed( 'FOG' );
			//
			// 	for ( let j = 0; j < MATERIAL_STRIDE; j ++ ) {
			//
			// 		floatArray[ index + j ] = 0;
			//
			// 	}
			//
			// 	// sample 0 .rgb
			// 	floatArray[ index + 0 * 4 + 0 ] = m.color.r;
			// 	floatArray[ index + 0 * 4 + 1 ] = m.color.g;
			// 	floatArray[ index + 0 * 4 + 2 ] = m.color.b;
			//
			// 	// sample 2 .a
			// 	floatArray[ index + 2 * 4 + 3 ] = getField( m, 'emissiveIntensity', 0.0 );
			//
			// 	// sample 3 .rgb
			// 	floatArray[ index + 3 * 4 + 0 ] = m.emissive.r;
			// 	floatArray[ index + 3 * 4 + 1 ] = m.emissive.g;
			// 	floatArray[ index + 3 * 4 + 2 ] = m.emissive.b;
			//
			// 	// sample 13 .g
			// 	// reusing opacity field
			// 	floatArray[ index + 13 * 4 + 1 ] = m.density;
			//
			// 	// side
			// 	floatArray[ index + 13 * 4 + 3 ] = 0.0;
			//
			// 	// sample 14 .b
			// 	floatArray[ index + 14 * 4 + 2 ] = 1 << 2;
			//
			// 	index += MATERIAL_STRIDE;
			// 	continue;
			//
			// }

			// color - offset 0
			floatArray[ index ++ ] = m.color.r;
			floatArray[ index ++ ] = m.color.g;
			floatArray[ index ++ ] = m.color.b;
			floatArray[ index ++ ] = getTexture( m, 'map' );

			// metalness & roughness - offset 4
			floatArray[ index ++ ] = getField( m, 'metalness', 0.0 );
			floatArray[ index ++ ] = getTexture( m, 'metalnessMap' );
			floatArray[ index ++ ] = getField( m, 'roughness', 0.0 );
			floatArray[ index ++ ] = getTexture( m, 'roughnessMap' );

			// transmission & emissiveIntensity - offset 8
			// three.js assumes a default f0 of 0.04 if no ior is provided which equates to an ior of 1.5
			floatArray[ index ++ ] = getField( m, 'ior', 1.5 );
			floatArray[ index ++ ] = getField( m, 'transmission', 0.0 );
			floatArray[ index ++ ] = getTexture( m, 'transmissionMap' );
			floatArray[ index ++ ] = getField( m, 'emissiveIntensity', 0.0 );

			// emission - offset 12
			if ( 'emissive' in m ) {

				floatArray[ index ++ ] = m.emissive.r;
				floatArray[ index ++ ] = m.emissive.g;
				floatArray[ index ++ ] = m.emissive.b;

			} else {

				floatArray[ index ++ ] = 0.0;
				floatArray[ index ++ ] = 0.0;
				floatArray[ index ++ ] = 0.0;

			}

			floatArray[ index ++ ] = getTexture( m, 'emissiveMap' );

			// normals - offset 16
			floatArray[ index ++ ] = getTexture( m, 'normalMap' );
			index ++; // because of vec2 alignment
			if ( 'normalScale' in m ) {

				floatArray[ index ++ ] = m.normalScale.x;
				floatArray[ index ++ ] = m.normalScale.y;

 			} else {

 				floatArray[ index ++ ] = 1;
 				floatArray[ index ++ ] = 1;

 			}

			// clearcoat - offset 20
			floatArray[ index ++ ] = getField( m, 'clearcoat', 0.0 );
			floatArray[ index ++ ] = getTexture( m, 'clearcoatMap' );
			floatArray[ index ++ ] = getTexture( m, 'clearcoatNormalMap' );
			index ++; // because of vec2 alignment

			// offset 24
			if ( 'clearcoatNormalScale' in m ) {

				floatArray[ index ++ ] = m.clearcoatNormalScale.x;
				floatArray[ index ++ ] = m.clearcoatNormalScale.y;

			} else {

				floatArray[ index ++ ] = 1;
				floatArray[ index ++ ] = 1;

			}

			floatArray[ index ++ ] = getField( m, 'clearcoatRoughness', 0.0 );
			floatArray[ index ++ ] = getTexture( m, 'clearcoatRoughnessMap' );

			// iridescence - offset 28
			floatArray[ index ++ ] = getTexture( m, 'iridescenceMap' );
			floatArray[ index ++ ] = getTexture( m, 'iridescenceThicknessMap' );

			floatArray[ index ++ ] = getField( m, 'iridescence', 0.0 );
			floatArray[ index ++ ] = getField( m, 'iridescenceIOR', 1.3 );

			// offset 32
			const iridescenceThicknessRange = getField( m, 'iridescenceThicknessRange', [ 100, 400 ] );
			floatArray[ index ++ ] = iridescenceThicknessRange[ 0 ];
			floatArray[ index ++ ] = iridescenceThicknessRange[ 1 ];
			// vec3f alignment requirements
			index ++;
			index ++;

			// specular color - offset 36
			if ( 'specularColor' in m ) {

				floatArray[ index ++ ] = m.specularColor.r;
				floatArray[ index ++ ] = m.specularColor.g;
				floatArray[ index ++ ] = m.specularColor.b;

			} else {

				floatArray[ index ++ ] = 1.0;
				floatArray[ index ++ ] = 1.0;
				floatArray[ index ++ ] = 1.0;

			}

			floatArray[ index ++ ] = getTexture( m, 'specularColorMap' );

			// specular intensity - offset 40
			floatArray[ index ++ ] = getField( m, 'specularIntensity', 1.0 );
			floatArray[ index ++ ] = getTexture( m, 'specularIntensityMap' );

			// isThinFilm
			const isThinFilm = getField( m, 'thickness', 0.0 ) === 0.0 && getField( m, 'attenuationDistance', Infinity ) === Infinity;
			floatArray[ index ++ ] = Number( isThinFilm );
			index ++;

			// attenuation - offset 44
			if ( 'attenuationColor' in m ) {

				floatArray[ index ++ ] = m.attenuationColor.r;
				floatArray[ index ++ ] = m.attenuationColor.g;
				floatArray[ index ++ ] = m.attenuationColor.b;

			} else {

				floatArray[ index ++ ] = 1.0;
				floatArray[ index ++ ] = 1.0;
				floatArray[ index ++ ] = 1.0;

			}

			floatArray[ index ++ ] = getField( m, 'attenuationDistance', Infinity );

			// alphaMap - offset 48
			floatArray[ index ++ ] = getTexture( m, 'alphaMap' );
			floatArray[ index ++ ] = Number( getField( m, 'castShadow', true ) ); // shadow
			floatArray[ index ++ ] = m.opacity;
			floatArray[ index ++ ] = m.alphaTest;

			// side & matte - offset 52
			if ( ! isThinFilm && m.transmission > 0.0 ) {

				floatArray[ index ++ ] = 0;

			} else {

				switch ( m.side ) {

				case FrontSide:
					floatArray[ index ++ ] = 1;
					break;
				case BackSide:
					floatArray[ index ++ ] = - 1;
					break;
				case DoubleSide:
					floatArray[ index ++ ] = 0;
					break;

				}

			}

			floatArray[ index ++ ] = Number( getField( m, 'matte', false ) ); // matte
			floatArray[ index ++ ] = getField( m, 'sheen', 0.0 );
			index ++; // vec3 alignment requirements

			// sheenColor - offset 56
			if ( 'sheenColor' in m ) {

				floatArray[ index ++ ] = m.sheenColor.r;
				floatArray[ index ++ ] = m.sheenColor.g;
				floatArray[ index ++ ] = m.sheenColor.b;

			} else {

				floatArray[ index ++ ] = 0.0;
				floatArray[ index ++ ] = 0.0;
				floatArray[ index ++ ] = 0.0;

			}

			floatArray[ index ++ ] = getTexture( m, 'sheenColorMap' );

			// sheenRoughness, flags - offset 60
			floatArray[ index ++ ] = getField( m, 'sheenRoughness', 0.0 );
			floatArray[ index ++ ] = getTexture( m, 'sheenRoughnessMap' );

			floatArray[ index ++ ] = Number( m.vertexColors );
			floatArray[ index ++ ] = Number( m.flatShading );

			// transparent, fogVolume - offset 64
			floatArray[ index ++ ] = Number( m.transparent );
			floatArray[ index ++ ] = 0;
			index ++;
			index ++;

			// map transform 15
			index += writeTextureMatrixToArray( m, 'map', floatArray, index );

			// metalnessMap transform 17
			index += writeTextureMatrixToArray( m, 'metalnessMap', floatArray, index );

			// roughnessMap transform 19
			index += writeTextureMatrixToArray( m, 'roughnessMap', floatArray, index );

			// transmissionMap transform 21
			index += writeTextureMatrixToArray( m, 'transmissionMap', floatArray, index );

			// emissiveMap transform 22
			index += writeTextureMatrixToArray( m, 'emissiveMap', floatArray, index );

			// normalMap transform 25
			index += writeTextureMatrixToArray( m, 'normalMap', floatArray, index );

			// clearcoatMap transform 27
			index += writeTextureMatrixToArray( m, 'clearcoatMap', floatArray, index );

			// clearcoatNormalMap transform 29
			index += writeTextureMatrixToArray( m, 'clearcoatNormalMap', floatArray, index );

			// clearcoatRoughnessMap transform 31
			index += writeTextureMatrixToArray( m, 'clearcoatRoughnessMap', floatArray, index );

			// sheenColorMap transform 33
			index += writeTextureMatrixToArray( m, 'sheenColorMap', floatArray, index );

			// sheenRoughnessMap transform 35
			index += writeTextureMatrixToArray( m, 'sheenRoughnessMap', floatArray, index );

			// iridescenceMap transform 37
			index += writeTextureMatrixToArray( m, 'iridescenceMap', floatArray, index );

			// iridescenceThicknessMap transform 39
			index += writeTextureMatrixToArray( m, 'iridescenceThicknessMap', floatArray, index );

			// specularColorMap transform 41
			index += writeTextureMatrixToArray( m, 'specularColorMap', floatArray, index );

			// specularIntensityMap transform 43
			index += writeTextureMatrixToArray( m, 'specularIntensityMap', floatArray, index );

			// alphaMap transform 45
			index += writeTextureMatrixToArray( m, 'alphaMap', floatArray, index );

		}

		return floatArray;

	}

	renderSample() {

		if ( ! this._renderer._initialized ) {

			this._renderer.init();
			return;

		}

		this._updateScale();

		this._pathTracer.update();

		this.renderToCanvasCallback( this._pathTracer.getResultBuffer(), this._renderer );

	}

	reset() {

	}

	dispose() {

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

				this._pathTracer.setSize( w, h );

			}

		}

	}

	getSampleCount() {

		return this._pathTracer.samples;

	}

	async getLatestSampleTimestamp() {

		return await this._pathTracer.getLatestSampleTimestamp();

	}

}

// TODO: Expose in three-mesh-bvh?
function dereferenceIndex( geometry, indirectBuffer, target ) {

	const unpacked = target.array;
	const indexArray = geometry.index ? geometry.index.array : null;
	for ( let i = 0, l = indirectBuffer.length; i < l; i ++ ) {

		const i3 = 3 * i;
		const v3 = 3 * indirectBuffer[ i ];
		for ( let c = 0; c < 3; c ++ ) {

			unpacked[ i3 + c ] = indexArray ? indexArray[ v3 + c ] : v3 + c;

		}

	}

}
