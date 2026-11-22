/** @import { WebGPURenderer } from 'three/webgpu' */
import { BackSide, FrontSide, RepeatWrapping, ClampToEdgeWrapping, MirroredRepeatWrapping, NearestFilter, StorageBufferAttribute, StructTypeNode } from 'three/webgpu';
import { storage, texture, uniformArray } from 'three/tsl';
import { wgslTagFn, proxyFn, contextProxy } from 'three-mesh-bvh/webgpu';
import { NodeProxyObject } from '../nodes/NodeProxyObject.js';
import { AtlasTexture } from '../AtlasTexture.js';
import { rand2, RNG_INDEX_SCATTER_DIRECTION } from '../nodes/random.wgsl.js';
import { diffuseDirectionFunc } from '../nodes/sampling.wgsl.js';
import { hitRecordStruct, scatterRecordStruct, materialMediumStruct } from '../nodes/structs.wgsl.js';
import { sampleTexelFunc, getTextureSizeFunc, getBasisFromNormalFunc } from '../nodes/utils.wgsl.js';
import { getTextureHash } from '../../core/utils/sceneUpdateUtils.js';

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

// the color, and the fields the ray traversal reads for culling and alpha testing
const materialStruct = new StructTypeNode( {
	// offset 0 floats
	color: 'vec3',
	map: 'int',

	// offset 4 floats
	alphaMap: 'int',
	vertexColors: 'int',
	transparent: 'int',
	opacity: 'float',

	// offset 8 floats
	alphaTest: 'float',
	side: 'float',

	// offset 12 floats
	mapTransform: 'mat3',
	// offset 24 floats
	alphaMapTransform: 'mat3',
	// total size = 36
}, 'Material' );

// the fields the kernels read
const surfaceRecordStruct = new StructTypeNode( {
	normal: 'vec3f',
	color: 'vec3f',
	emission: 'vec3f',
	opacity: 'f32',
}, 'SurfaceRecord' );

/**
 * Defines how the pathtracer interprets the scene's materials. The base model renders each material's color as a
 * diffuse surface. See GLTFShadingModel for the full glTF material.
 *
 * The ray traversal reads a material struct's "side", "transparent", "alphaTest", "opacity", "vertexColors", "map",
 * "alphaMap", "mapTransform" and "alphaMapTransform" fields for culling and alpha testing, so a custom material
 * struct needs those along with the fields its own functions read.
 *
 * A custom surface record struct must be named "SurfaceRecord" and keep the fields the kernels read: "normal",
 * "color", "emission" and "opacity", along with any its functions read.
 *
 * The kernels read the "structs", "storage" and "fns" members through the node context as "shadingModel".
 */
export class ShadingModel {

	constructor() {

		// members are accessed through proxy nodes so they can be referenced up front and keep working
		// across rebuilds, like BVHComputeData
		this.structs = new NodeProxyObject( { material: null, surfaceRecord: null } );
		this.storage = new NodeProxyObject( { materials: null } );
		this.fns = new NodeProxyObject( {
			sampleTexel: null,
			getTextureSize: null,
			getSurfaceRecord: null,
			bsdfSample: null,
			bsdfEvalPdf: null,
			getMaterialMedium: null,
			getDispersion: null,
			applyDispersion: null,
			isAuxSurface: null,
			isMatte: null,
		}, proxyFn );
		this.textureAtlas = new AtlasTexture();
		this.materials = [];
		this.materialsMap = new Map();
		this.textures = [];
		this.texturesMap = new Map();

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
	 * - "fns.sampleTexel": ( uv, map, lod ) -> vec4f, sampling a material's texture from the atlas.
	 * - "fns.getTextureSize": ( map ) -> vec2f, the size of a material's texture in the atlas.
	 * - "fns.getSurfaceRecord": ( material, objectColor, vertexData, hit, view, blurRoughness ) -> SurfaceRecord,
	 *   reading the surface from the material struct at a HitRecord, tinted by the object's instance color.
	 * - "fns.bsdfSample": ( hit, surface, worldView ) -> ScatterRecord, sampling the next direction.
	 * - "fns.bsdfEvalPdf": ( hit, surface, worldView, worldLight ) -> ScatterRecord, the bsdf value and sampling
	 *   pdf for a given light direction, used by next event estimation.
	 * - "fns.getMaterialMedium": ( materialIndex ) -> MaterialMedium, the material's volume. Defaults to none.
	 * - "fns.getDispersion": ( surface ) -> f32, the surface's dispersion. Defaults to zero.
	 * - "fns.applyDispersion": ( ptr<SurfaceRecord>, dispersion, wavelength ), refracting the surface at a wavelength.
	 *   Defaults to a no-op.
	 * - "fns.isAuxSurface": ( surface, scatter ) -> bool, whether the denoiser's guides show the surface rather than
	 *   what it reflects or transmits. Defaults to true.
	 * - "fns.isMatte": ( surface ) -> bool, whether the surface renders transparent to the camera. Defaults to false.
	 */
	updateFunctions() {

		const { structs, fns, textureAtlas } = this;
		structs.material = materialStruct;
		structs.surfaceRecord = surfaceRecordStruct;

		// the atlas refills its texture info array in place, so this reads the latest placements
		const textureInfo = uniformArray( textureAtlas.textureInfo, 'uvec4' ).setName( 'shadingModel_textureInfo' );
		fns.sampleTexel = sampleTexelFunc( textureInfo, texture( textureAtlas.texture ) );
		fns.getTextureSize = getTextureSizeFunc( textureInfo );

		fns.getSurfaceRecord = wgslTagFn/* wgsl */`

			fn getSurfaceRecord(
				material: ${ structs.material },
				objectColor: vec4f,
				vertexData: ${ contextProxy( 'bvhData.structs.attributes' ) },
				hit: ${ hitRecordStruct },
				view: vec3f,
				blurRoughness: f32,
			) -> ${ structs.surfaceRecord } {

				var surf: ${ structs.surfaceRecord };
				surf.normal = hit.normal;
				surf.color = material.color * objectColor.rgb;
				surf.opacity = 1.0;
				return surf;

			}

		`;

		fns.bsdfSample = wgslTagFn/* wgsl */`

			fn bsdfSample( hit: ${ hitRecordStruct }, surf: ${ structs.surfaceRecord }, worldWo: vec3f ) -> ${ scatterRecordStruct } {

				var record: ${ scatterRecordStruct };

				let basis = ${ getBasisFromNormalFunc }( surf.normal );
				let wo = normalize( worldWo * basis );
				let wi = ${ diffuseDirectionFunc }( wo, ${ rand2 }( ${ RNG_INDEX_SCATTER_DIRECTION } ) );
				record.color = surf.color * max( wi.z, 0.0 ) / PI;
				record.pdf = max( wi.z, 0.0 ) / PI;
				record.direction = normalize( basis * wi );

				return record;

			}

		`;

		fns.bsdfEvalPdf = wgslTagFn/* wgsl */`

			fn bsdfEvalPdf( hit: ${ hitRecordStruct }, surf: ${ structs.surfaceRecord }, worldWo: vec3f, worldWi: vec3f ) -> ${ scatterRecordStruct } {

				var record: ${ scatterRecordStruct };
				record.direction = worldWi;

				let cosine = max( dot( surf.normal, worldWi ), 0.0 );
				record.color = surf.color * cosine / PI;
				record.pdf = cosine / PI;

				return record;

			}

		`;

		fns.getMaterialMedium = wgslTagFn/* wgsl */`

			fn getMaterialMedium( materialIndex: u32 ) -> ${ materialMediumStruct } {

				var medium: ${ materialMediumStruct };
				return medium;

			}

		`;

		fns.getDispersion = wgslTagFn/* wgsl */`

			fn getDispersion( surf: ${ structs.surfaceRecord } ) -> f32 {

				return 0.0;

			}

		`;

		fns.applyDispersion = wgslTagFn/* wgsl */`

			fn applyDispersion( surf: ptr<function, ${ structs.surfaceRecord }>, dispersion: f32, wavelength: f32 ) -> void {

			}

		`;

		fns.isAuxSurface = wgslTagFn/* wgsl */`

			fn isAuxSurface( surf: ${ structs.surfaceRecord }, scatterRec: ${ scatterRecordStruct } ) -> bool {

				return true;

			}

		`;

		fns.isMatte = wgslTagFn/* wgsl */`

			fn isMatte( surf: ${ structs.surfaceRecord } ) -> bool {

				return false;

			}

		`;

	}

	/**
	 * Packs the materials' textures into the atlas "fns.sampleTexel" reads. Call after "updateMaterials".
	 * Returns whether the number of textures changed, so the kernels need rebuilding.
	 *
	 * @param {WebGPURenderer} renderer
	 * @returns {boolean}
	 */
	updateTextures( renderer ) {

		// the atlas refills its texture info array in place, but the kernels size it when they're built
		const { textureAtlas } = this;
		const { length } = textureAtlas.textureInfo;
		textureAtlas.setTextures( renderer, this.textures );

		return textureAtlas.textureInfo.length !== length;

	}

	/**
	 * Returns the "*Map" descriptor of a material's texture, or -1 without one, adding the texture to
	 * "textures" by its shareable source. For use in "writeMaterialsBuffer".
	 */
	getTextureDescriptor( material, key ) {

		if ( key in material && material[ key ] ) {

			const { textures, texturesMap } = this;
			const texture = material[ key ];
			const hash = getTextureHash( texture );

			if ( ! texturesMap.has( hash ) ) {

				texturesMap.set( hash, textures.length );
				textures.push( texture );

			}

			const idx = texturesMap.get( hash );							// 23 bits
			const channel = texture.channel & 7;							// 3 bits
			const wrapS = encodeTextureWrap( texture.wrapS );				// 2 bits
			const wrapT = encodeTextureWrap( texture.wrapT );				// 2 bits
			const nearest = texture.magFilter === NearestFilter ? 1 : 0;	// 1 bit
			return ( nearest << 30 ) | ( wrapT << 28 ) | ( wrapS << 26 ) | ( channel << 23 ) | ( idx & 0x7fffff );

		} else {

			return - 1;

		}

	}

	/**
	 * Returns whether the material is a volume the camera can be inside of. Defaults to false.
	 */
	isVolumeMaterial( /* material */ ) {

		return false;

	}

	/**
	 * Writes the uv transform of a material's texture as a padded mat3, returning the floats written. For
	 * use in "writeMaterialsBuffer".
	 */
	writeTextureMatrixToArray( material, textureKey, array, offset ) {

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

	/**
	 *
	 * Must write the given materials to an array in the material struct layout, returning
	 * { materialData }. The "*Map" fields index the textures added with "getTextureDescriptor"
	 *
	 */
	writeMaterialsBuffer( materials ) {

		// NOTE: make the minimum material buffer length 2 in order to avoid TSL converting it to a scalar
		// TODO: remove this when fixed in three
		const length = this.structs.material.proxyNode.getLength();
		const floatArray = new Float32Array( Math.max( materials.length, 2 ) * length );
		const intArray = new Int32Array( floatArray.buffer );
		for ( let i = 0, l = materials.length; i < l; i ++ ) {

			const m = materials[ i ];
			let index = i * length;

			// offset 0, materials without a color, like NodeMaterial or ShaderMaterial, default to white
			floatArray[ index ++ ] = 'color' in m ? m.color.r : 1.0;
			floatArray[ index ++ ] = 'color' in m ? m.color.g : 1.0;
			floatArray[ index ++ ] = 'color' in m ? m.color.b : 1.0;
			intArray[ index ++ ] = this.getTextureDescriptor( m, 'map' );

			// offset 4
			intArray[ index ++ ] = this.getTextureDescriptor( m, 'alphaMap' );
			intArray[ index ++ ] = Number( m.vertexColors );
			intArray[ index ++ ] = Number( m.transparent );
			floatArray[ index ++ ] = m.opacity;

			// offset 8
			floatArray[ index ++ ] = m.alphaTest;
			floatArray[ index ++ ] = m.side === FrontSide ? 1 : m.side === BackSide ? - 1 : 0;
			index += 2;

			// offset 12
			index += this.writeTextureMatrixToArray( m, 'map', floatArray, index );
			index += this.writeTextureMatrixToArray( m, 'alphaMap', floatArray, index );

		}

		return { materialData: intArray };

	}

	updateMaterials( root ) {

		const { materials, materialsMap, textures, texturesMap, structs } = this;
		materialsMap.clear();
		materials.length = 0;

		// collected again by "getTextureDescriptor" as the materials are written
		texturesMap.clear();
		textures.length = 0;
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

		const { materialData } = this.writeMaterialsBuffer( materials );
		const materialStruct = structs.material.proxyNode;
		const materialsStorage = this.storage.materials.proxyNode;
		const count = materialData.length / materialStruct.getLength();
		if ( materialsStorage.value.count < count ) {

			materialsStorage.value.dispose();
			materialsStorage.value = new StorageBufferAttribute( materialData, materialStruct.getLength() );

		}

		materialsStorage.value.array.set( materialData );
		materialsStorage.value.needsUpdate = true;

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
