/** @import { WebGPURenderer } from 'three/webgpu' */
import { BackSide, FrontSide, DoubleSide, RepeatWrapping, ClampToEdgeWrapping, MirroredRepeatWrapping, NearestFilter, StorageBufferAttribute } from 'three/webgpu';
import { storage, texture, uniformArray } from 'three/tsl';
import { wgslTagFn, proxyFn, contextProxy, contextProxyFn } from 'three-mesh-bvh/webgpu';
import { NodeProxyObject } from '../nodes/NodeProxyObject.js';
import { AtlasTexture } from '../AtlasTexture.js';
import { rand2, RNG_INDEX_SCATTER_DIRECTION } from '../nodes/random.wgsl.js';
import { diffuseDirectionFunc } from '../nodes/sampling.wgsl.js';
import { materialStruct, scatterRecordStruct, surfaceRecordStruct } from '../nodes/structs.wgsl.js';
import { getSurfaceRecordFunc } from '../nodes/material.wgsl.js';
import { sampleTexelFunc } from '../nodes/utils.wgsl.js';
import { getTextureHash } from '../../core/utils/sceneUpdateUtils.js';

/**
 * Defines how the pathtracer interprets the scene's materials
 *
 * A custom material struct must keep the fields the ray traversal reads: "opacity", "side", "transparent",
 * "alphaTest", "vertexColors", "map", "mapTransform", "alphaMap" and "alphaMapTransform".
 *
 * A custom surface record struct must be named "SurfaceRecord" and keep the fields the kernels read:
 * "normal", "color", "emission", "opacity", "matte", "roughness", "metalness", "ior", "eta", "f0",
 * "frontFace", "transmission", "thinWall", "attenuationColor", "attenuationDistance", "dispersion",
 * "multiscatterColor", "scatterStrength" and "scatterAnisotropy".
 *
 * The kernels read the "structs", "storage" and "fns" members through the node context as "shadingModel".
 */
export class ShadingModel {

	constructor() {

		// members are accessed through proxy nodes so they can be referenced up front and keep working
		// across rebuilds, like BVHComputeData
		this.structs = new NodeProxyObject( { material: null, surfaceRecord: null } );
		this.storage = new NodeProxyObject( { materials: null } );
		this.fns = new NodeProxyObject( { sampleTexel: null, getSurfaceRecord: null, bsdfSample: null, bsdfEvalPdf: null }, proxyFn );
		this.textureAtlas = new AtlasTexture();
		this.materials = [];
		this.materialsMap = new Map();
		this.textures = [];

	}

	/**
	 *
	 * Called once per material
	 * Adds ability to initialize state
	 *
	 */
	init( /* renderer */ ) {

	}

	/**
	 * Assigns the structs and functions the kernels read. Subclasses call it and then replace the ones
	 * they change:
	 * - "structs.material": the struct each material is written to.
	 * - "structs.surfaceRecord": the struct a surface is evaluated into at a hit.
	 * - "fns.getSurfaceRecord": ( material, objectColor, vertexData, hit, view, blurRoughness ) -> SurfaceRecord,
	 *   reading the surface from the material struct at a HitRecord, tinted by the object's instance color.
	 * - "fns.bsdfSample": ( worldView, surface ) -> ScatterRecord, sampling the next direction.
	 * - "fns.bsdfEvalPdf": ( worldView, worldLight, surface ) -> ScatterRecord, the bsdf value and sampling
	 *   pdf for a given light direction, used by next event estimation.
	 */
	updateFunctions() {

		const { structs, fns } = this;
		structs.material = materialStruct;
		structs.surfaceRecord = surfaceRecordStruct;

		// the geometry helpers come from the bvh data through the node context
		fns.getSurfaceRecord = getSurfaceRecordFunc( {
			materialStruct: structs.material,
			surfaceRecordStruct: structs.surfaceRecord,
			attributesStruct: contextProxy( 'bvhData.structs.attributes' ),
			sampleTexel: fns.sampleTexel,
			getUvFromChannel: contextProxyFn( 'bvhData.fns.getUvFromChannel' ),
			getColor: contextProxyFn( 'bvhData.fns.getColor' ),
		} );

		fns.bsdfSample = wgslTagFn/* wgsl */`

			fn bsdfSample( worldWo: vec3f, surf: ${ structs.surfaceRecord } ) -> ${ scatterRecordStruct } {

				var record: ${ scatterRecordStruct };

				let wo = normalize( surf.normalInvBasis * worldWo );
				let wi = ${ diffuseDirectionFunc }( wo, ${ rand2 }( ${ RNG_INDEX_SCATTER_DIRECTION } ) );
				record.color = surf.color * max( wi.z, 0.0 );
				record.pdf = max( wi.z, 0.0 ) / PI;
				record.direction = normalize( surf.normalBasis * wi );

				return record;

			}

		`;

		fns.bsdfEvalPdf = wgslTagFn/* wgsl */`

			fn bsdfEvalPdf( worldWo: vec3f, worldWi: vec3f, surf: ${ structs.surfaceRecord } ) -> ${ scatterRecordStruct } {

				var record: ${ scatterRecordStruct };
				record.direction = worldWi;

				let wo = normalize( surf.normalInvBasis * worldWo );
				let wi = normalize( surf.normalInvBasis * worldWi );
				record.color = surf.color * max( wi.z, 0.0 );
				record.pdf = max( wi.z, 0.0 ) / PI;

				return record;

			}

		`;

	}

	/**
	 * Packs the materials' textures into the atlas "fns.sampleTexel" reads. Call after "updateMaterials".
	 *
	 * @param {WebGPURenderer} renderer
	 */
	updateTextures( renderer ) {

		const { textureAtlas } = this;
		textureAtlas.setTextures( renderer, this.textures );

		// rebuilt since the texture info array can change length
		const textureInfo = uniformArray( textureAtlas.textureInfo, 'uvec4' ).setName( 'shadingModel_textureInfo' );
		this.fns.sampleTexel = sampleTexelFunc( textureInfo, texture( textureAtlas.texture ) );

	}

	/**
	 *
	 * Must write the given materials to an array in the material struct layout, returning
	 * { materialData, textures } with the textures the "*Map" fields index
	 *
	 */
	writeMaterialsBuffer( materials ) {

		function encodeTextureWrap( wrap ) {

			switch ( wrap ) {

				case RepeatWrapping:
					return 0;
				case ClampToEdgeWrapping:
					return 1;
				case MirroredRepeatWrapping:
					return 2;
				default:
					return 0;

			}

		}

		function getTexture( material, key ) {

			if ( key in material && material[ key ] ) {

				const texture = material[ key ];
				const hash = getTextureHash( texture );

				if ( ! textureLookUp.has( hash ) ) {

					textureLookUp.set( hash, textureLookUp.size );
					textures.push( texture );

				}

				const idx = textureLookUp.get( hash );							// 23 bits
				const channel = texture.channel & 7;							// 3 bits
				const wrapS = encodeTextureWrap( texture.wrapS );				// 2 bits
				const wrapT = encodeTextureWrap( texture.wrapT );				// 2 bits
				const nearest = texture.magFilter === NearestFilter ? 1 : 0;	// 1 bit
				return ( nearest << 30 ) | ( wrapT << 28 ) | ( wrapS << 26 ) | ( channel << 23 ) | ( idx & 0x7fffff );

			} else {

				return - 1;

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

		// Collect and index the list of textures based on shareable source
		const textureLookUp = new Map();
		const textures = [];

		// NOTE: make the minimum material buffer length 2 in order to avoid TSL converting it to a scalar
		// TODO: remove this when fixed in three
		const materialBufferLength = Math.max( materials.length, 2 );
		const floatArray = new Float32Array( materialBufferLength * this.structs.material.proxyNode.getLength() );
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
			floatArray[ index ++ ] = getField( m, 'iridescenceThicknessMinimum', 100 );
			floatArray[ index ++ ] = getField( m, 'iridescenceThicknessMaximum', 400 );
			floatArray[ index ++ ] = getField( m, 'diffuseRoughness', 0.0 );
			floatArray[ index ++ ] = getField( m, 'dispersion', 0.0 );

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

			// isThinWall
			const isThinWall = getField( m, 'thickness', 0.0 ) === 0.0 && getField( m, 'attenuationDistance', Infinity ) === Infinity;
			intArray[ index ++ ] = Number( isThinWall );
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
			if ( ! isThinWall && m.transmission > 0.0 ) {

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

			// anisotropy, anisotropyRotation, anisotropyMap - offset 66
			floatArray[ index ++ ] = getField( m, 'anisotropy', 0.0 );
			floatArray[ index ++ ] = getField( m, 'anisotropyRotation', 0.0 );
			intArray[ index ++ ] = getTexture( m, 'anisotropyMap' );
			index ++; // padding for mat3 alignment
			index ++;
			index ++;

			// map transform - offset 72
			index += writeTextureMatrixToArray( m, 'map', floatArray, index );

			// metalnessMap transform - offset 84
			index += writeTextureMatrixToArray( m, 'metalnessMap', floatArray, index );

			// roughnessMap transform - offset 96
			index += writeTextureMatrixToArray( m, 'roughnessMap', floatArray, index );

			// transmissionMap transform - offset 108
			index += writeTextureMatrixToArray( m, 'transmissionMap', floatArray, index );

			// emissiveMap transform - offset 120
			index += writeTextureMatrixToArray( m, 'emissiveMap', floatArray, index );

			// normalMap transform - offset 132
			index += writeTextureMatrixToArray( m, 'normalMap', floatArray, index );

			// clearcoatMap transform - offset 144
			index += writeTextureMatrixToArray( m, 'clearcoatMap', floatArray, index );

			// clearcoatNormalMap transform - offset 156
			index += writeTextureMatrixToArray( m, 'clearcoatNormalMap', floatArray, index );

			// clearcoatRoughnessMap transform - offset 168
			index += writeTextureMatrixToArray( m, 'clearcoatRoughnessMap', floatArray, index );

			// sheenColorMap transform - offset 180
			index += writeTextureMatrixToArray( m, 'sheenColorMap', floatArray, index );

			// sheenRoughnessMap transform - offset 192
			index += writeTextureMatrixToArray( m, 'sheenRoughnessMap', floatArray, index );

			// iridescenceMap transform - offset 204
			index += writeTextureMatrixToArray( m, 'iridescenceMap', floatArray, index );

			// iridescenceThicknessMap transform - offset 216
			index += writeTextureMatrixToArray( m, 'iridescenceThicknessMap', floatArray, index );

			// specularColorMap transform - offset 228
			index += writeTextureMatrixToArray( m, 'specularColorMap', floatArray, index );

			// specularIntensityMap transform - offset 240
			index += writeTextureMatrixToArray( m, 'specularIntensityMap', floatArray, index );

			// alphaMap transform - offset 252
			index += writeTextureMatrixToArray( m, 'alphaMap', floatArray, index );

			// anisotropyMap transform - offset 264
			index += writeTextureMatrixToArray( m, 'anisotropyMap', floatArray, index );

			// scattering volume - offset 276
			const multiscatterColor = getField( m, 'multiscatterColor', null );
			floatArray[ index ++ ] = multiscatterColor ? multiscatterColor.r : 1.0;
			floatArray[ index ++ ] = multiscatterColor ? multiscatterColor.g : 1.0;
			floatArray[ index ++ ] = multiscatterColor ? multiscatterColor.b : 1.0;
			floatArray[ index ++ ] = getField( m, 'scatterStrength', 0.0 );
			floatArray[ index ++ ] = getField( m, 'scatterAnisotropy', 0.0 );

			// padding to the struct's 16 byte alignment
			index += 3;

		}

		return { materialData: intArray, textures };

	}

	updateMaterials( root ) {

		const { materials, materialsMap, structs } = this;
		materialsMap.clear();
		materials.length = 0;
		root.traverse( o => {

			if ( o.material ) {

				if ( Array.isArray( o.material ) ) {

					o.material.forEach( m => m && add( m ) );

				} else {

					add( o.material );

				}

			}

		} );

		materials
			.sort( ( a, b ) => {

				return a.uuid < b.uuid ? 1 : - 1;

			} )
			.forEach( ( m, i ) => {

				materialsMap.set( m, i );

			} );

		// the storage is created once so the kernels keep referencing it as it grows
		if ( this.storage.materials.proxyNode === null ) {

			const materialStruct = structs.material.proxyNode;
			const attr = new StorageBufferAttribute( new Uint8Array(), materialStruct.getLength() );
			this.storage.materials = storage( attr, materialStruct ).toReadOnly().setName( 'bvh_materials' );

		}

		const { materialData, textures } = this.writeMaterialsBuffer( materials );
		const materialStruct = structs.material.proxyNode;
		const materialsStorage = this.storage.materials.proxyNode;
		const count = materialData.length / materialStruct.getLength();
		if ( materialsStorage.value.count < count ) {

			materialsStorage.value.dispose();
			materialsStorage.value = new StorageBufferAttribute( materialData, materialStruct.getLength() );

		}

		materialsStorage.value.array.set( materialData );
		materialsStorage.value.needsUpdate = true;

		this.textures = textures;

		function add( mat ) {

			if ( ! materialsMap.has( mat ) ) {

				materials.push( mat );
				materialsMap.set( mat, - 1 );

			}

		}

	}

	getMaterialIndex( material ) {

		const { materialsMap } = this;
		return materialsMap.has( material ) ? materialsMap.get( material ) : - 1;

	}

	dispose() {

		this.storage.materials.proxyNode?.value.dispose();
		this.storage.materials = null;
		this.textureAtlas.dispose();
		this.initialized = false;

	}

}
