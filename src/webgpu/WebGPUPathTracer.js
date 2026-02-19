import { FrontSide, DoubleSide, BackSide, StorageBufferAttribute, PerspectiveCamera, Scene, Vector2, Clock } from 'three/webgpu';
import { PathTracingSceneGenerator } from '../core/PathTracingSceneGenerator.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderToScreenNodeMaterial } from './materials/RenderToScreenMaterial.js';
import { MegaKernelPathTracer } from './MegaKernelPathTracer.js';
import { WaveFrontPathTracer } from './WaveFrontPathTracer.js';
import { RenderTarget2DArrayWebGPU } from './RenderTarget2DArrayWebGPU.js';
import { getTextures } from '../core/utils/sceneUpdateUtils.js';
import { getTextureHash } from '../core/utils/sceneUpdateUtils.js';

const MATERIAL_STRIDE = 260;

const _resolution = new Vector2();
export class WebGPUPathTracer {

	get bounces() {

		return this._pathTracer.bounces;

	}

	set bounces( v ) {

		this._pathTracer.bounces = v;

	}

	useMegakernel( value ) {

		this._pathTracer.dispose();
		this._pathTracer = value ? new MegaKernelPathTracer( this._renderer ) : new WaveFrontPathTracer( this._renderer );
		this._generator = new PathTracingSceneGenerator();

	}

	constructor( renderer ) {

		// members
		this._renderer = renderer;
		this._generator = new PathTracingSceneGenerator();
		// this._pathTracer = new MegaKernelPathTracer( renderer );
		this._pathTracer = new WaveFrontPathTracer( renderer );
		this._queueReset = false;
		this._clock = new Clock();

		// texture array for material textures
		this._textureArray = new RenderTarget2DArrayWebGPU( 1024, 1024 );

		// options
		this.renderScale = 1;
		this.synchronizeRenderSize = true;
		this.renderToCanvas = true;
		this._blitQuad = new FullScreenQuad( new RenderToScreenNodeMaterial() );

		// initialize the scene so it doesn't fail
		this.setScene( new Scene(), new PerspectiveCamera() );

	}

	setScene( scene, camera ) {

		scene.updateMatrixWorld( true );
		camera.updateMatrixWorld();

		const generator = this._generator;
		generator.setObjects( scene );

		const result = generator.generate();
		return this._updateFromResults( scene, camera, result );

	}

	setCamera( camera ) {

		this.camera = camera;
		this.updateCamera();

	}

	updateCamera() {

		const camera = this.camera;
		camera.updateMatrixWorld();

		this._pathTracer.setCamera( camera );
		this.reset();

	}

	reset() {

		this._pathTracer.reset();

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
		const renderer = this._renderer;

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

			const newBvhRoots = new StorageBufferAttribute( new Float32Array( bvh._roots[ 0 ] ), 8 );
			newBvhRoots.name = 'BVH Roots';
			newGeometryData.bvh = newBvhRoots;

			const attributeData = this.collectAttributes( geometry );
			const newAttributes = new StorageBufferAttribute( attributeData, 12 );
			newAttributes.name = 'Vertex Attributes';
			newGeometryData.attributes = newAttributes;

		}

		if ( needsMaterialIndexUpdate ) {

			const newMaterialIndex = new StorageBufferAttribute( geometry.attributes.materialIndex.array, 1 );
			newMaterialIndex.name = 'Material Index';
			newGeometryData.materialIndex = newMaterialIndex;

		}

		// collect textures and update texture array
		const textures = getTextures( materials );
		const textureArray = this._textureArray;
		textureArray.setTextures( renderer, textures );

		const newMaterialsData = this.writeMaterialsBuffer( materials, textures );

		const newMaterialsBuffer = new StorageBufferAttribute( newMaterialsData, MATERIAL_STRIDE );
		newMaterialsBuffer.name = 'Material Data';
		newGeometryData.materials = newMaterialsBuffer;

		pathTracer.setGeometryData( newGeometryData );

		this.setCamera( camera );

	}

	collectAttributes( geometry ) {

		const count = geometry.attributes.position.count;
		const data = new Float32Array( count * 16 );

		const colorAttr = geometry.attributes.color;
		const normalAttr = geometry.attributes.normal;
		const uvAttr = geometry.attributes.uv;
		const tangentAttr = geometry.attributes.tangent;

		for ( let i = 0; i < count; i ++ ) {

			const offset = i * 16;

			// color - vec3f, aligned to 4 floats (vec4)
			{

				let r = 1.0;
				let g = 1.0;
				let b = 1.0;

				if ( colorAttr ) {

					r = colorAttr.getX( i );
					g = colorAttr.getY( i );
					b = colorAttr.getZ( i );

				}

				data[ offset + 0 ] = r;
				data[ offset + 1 ] = g;
				data[ offset + 2 ] = b;

			}

			// normal - vec3f, aligned to 4 floats (vec4)
			{

				let x = 0.0;
				let y = 0.0;
				let z = 1.0;

				if ( normalAttr ) {

					x = normalAttr.getX( i );
					y = normalAttr.getY( i );
					z = normalAttr.getZ( i );

				}

				data[ offset + 4 ] = x;
				data[ offset + 5 ] = y;
				data[ offset + 6 ] = z;

			}

			// tangent - vec3f, aligned to 4 floats (vec4)
			{

				let x = 0.0;
				let y = 1.0;
				let z = 0.0;
				let w = 1.0;

				if ( tangentAttr ) {

					x = tangentAttr.getX( i );
					y = tangentAttr.getY( i );
					z = tangentAttr.getZ( i );
					w = tangentAttr.getW( i );

				}

				data[ offset + 8 ] = x;
				data[ offset + 9 ] = y;
				data[ offset + 10 ] = z;
				data[ offset + 11 ] = w;

			}

			// uv - vec2f, aligned to 4 floats (vec4)
			{

				let x = 0.0;
				let y = 0.0;

				if ( uvAttr ) {

					x = uvAttr.getX( i );
					y = uvAttr.getY( i );

				}

				data[ offset + 12 ] = x;
				data[ offset + 13 ] = y;

			}

		}

		return data;

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

					array[ offset + 4 * i + 0 ] = elements[ 3 * i + 0 ];
					array[ offset + 4 * i + 1 ] = elements[ 3 * i + 1 ];
					array[ offset + 4 * i + 2 ] = elements[ 3 * i + 2 ];
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
		const intArray = new Int32Array( floatArray.buffer );

		// TODO: make features work
		// features.reset();
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
			intArray[ index ++ ] = getTexture( m, 'map' );

			// metalness & roughness - offset 4
			floatArray[ index ++ ] = getField( m, 'metalness', 0.0 );
			intArray[ index ++ ] = getTexture( m, 'metalnessMap' );
			floatArray[ index ++ ] = getField( m, 'roughness', 0.0 );
			intArray[ index ++ ] = getTexture( m, 'roughnessMap' );

			// transmission & emissiveIntensity - offset 8
			// three.js assumes a default f0 of 0.04 if no ior is provided which equates to an ior of 1.5
			floatArray[ index ++ ] = getField( m, 'ior', 1.5 );
			floatArray[ index ++ ] = getField( m, 'transmission', 0.0 );
			intArray[ index ++ ] = getTexture( m, 'transmissionMap' );
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

			intArray[ index ++ ] = getTexture( m, 'emissiveMap' );

			// normals - offset 16
			intArray[ index ++ ] = getTexture( m, 'normalMap' );
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
			intArray[ index ++ ] = getTexture( m, 'clearcoatMap' );
			intArray[ index ++ ] = getTexture( m, 'clearcoatNormalMap' );
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
			intArray[ index ++ ] = getTexture( m, 'clearcoatRoughnessMap' );

			// iridescence - offset 28
			intArray[ index ++ ] = getTexture( m, 'iridescenceMap' );
			intArray[ index ++ ] = getTexture( m, 'iridescenceThicknessMap' );

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

			intArray[ index ++ ] = getTexture( m, 'specularColorMap' );

			// specular intensity - offset 40
			floatArray[ index ++ ] = getField( m, 'specularIntensity', 1.0 );
			intArray[ index ++ ] = getTexture( m, 'specularIntensityMap' );

			// isThinFilm
			const isThinFilm = getField( m, 'thickness', 0.0 ) === 0.0 && getField( m, 'attenuationDistance', Infinity ) === Infinity;
			intArray[ index ++ ] = Number( isThinFilm );
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
			intArray[ index ++ ] = getTexture( m, 'alphaMap' );
			intArray[ index ++ ] = Number( getField( m, 'castShadow', true ) ); // shadow
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

			intArray[ index ++ ] = Number( getField( m, 'matte', false ) ); // matte
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

			intArray[ index ++ ] = getTexture( m, 'sheenColorMap' );

			// sheenRoughness, flags - offset 60
			floatArray[ index ++ ] = getField( m, 'sheenRoughness', 0.0 );
			intArray[ index ++ ] = getTexture( m, 'sheenRoughnessMap' );

			intArray[ index ++ ] = Number( m.vertexColors );
			intArray[ index ++ ] = Number( m.flatShading );

			// transparent, fogVolume - offset 64
			intArray[ index ++ ] = Number( m.transparent );
			intArray[ index ++ ] = 0;
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

			return;

		}


		this._textureArray.update( this._renderer );
		this._pathTracer.setTextures( this._textureArray.texture );

		this._updateScale();
		this._pathTracer.update();

		const blitQuad = this._blitQuad;
		blitQuad.material.texture = this._pathTracer.outputTarget;
		blitQuad.render( this._renderer );

	}

	dispose() {

		this._pathTracer.dispose();
		this._textureArray.dispose();

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
