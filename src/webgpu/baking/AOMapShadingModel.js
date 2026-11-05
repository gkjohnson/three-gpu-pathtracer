import { StructTypeNode } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { wgslTagFn, contextProxy, contextProxyFn } from 'three-mesh-bvh/webgpu';
import { ShadingModel } from '../shadingModels/ShadingModel.js';
import { hitRecordStruct, scatterRecordStruct } from '../nodes/structs.wgsl.js';
import { ensureValidReflectionNormal, ensureValidViewNormal } from '../nodes/material.wgsl.js';

// Only what the ray traversal reads for alpha testing and the normal map for the hemisphere
const aoMaterialStruct = new StructTypeNode( {
	// offset 0 floats
	map: 'int',
	alphaMap: 'int',
	normalMap: 'int',
	vertexColors: 'int',

	// offset 4 floats
	opacity: 'float',
	alphaTest: 'float',
	side: 'float',
	transparent: 'int',

	// offset 8 floats
	flatShading: 'int',
	_alignment0: 'int',
	normalScale: 'vec2',

	// offset 12 floats
	mapTransform: 'mat3',
	// offset 24 floats
	alphaMapTransform: 'mat3',
	// offset 36 floats
	normalMapTransform: 'mat3',
	// total size = 48
}, 'Material' );

// The fields the kernels read
const aoSurfaceRecordStruct = new StructTypeNode( {
	normal: 'vec3f',
	frontFace: 'bool',
	eta: 'f32',
	f0: 'f32',
	roughness: 'f32',
	metalness: 'f32',
	color: 'vec3f',
	emission: 'vec3f',
	opacity: 'f32',
	matte: 'bool',
	ior: 'f32',
	transmission: 'f32',
	thinWall: 'bool',
	attenuationColor: 'vec3f',
	attenuationDistance: 'f32',
	dispersion: 'f32',
	multiscatterColor: 'vec3f',
	scatterStrength: 'f32',
	scatterAnisotropy: 'f32',
}, 'SurfaceRecord' );

/**
 * Shading model for baking ambient occlusion. A hit emits its distance's share of the radius
 * and ends the path, so with a white background a texel accumulates how open its hemisphere is,
 * with occluders fading in as they get closer, as Substance Painter's baker does.
 */
export class AOMapShadingModel extends ShadingModel {

	/**
	 * @param {Object} [options]
	 * @param {number} [options.radius=1] - Distance at which an occluder stops counting.
	 * @param {boolean} [options.falloff=true] - Whether an occluder fades in with distance, or
	 *   counts fully anywhere within the radius as in Cycles.
	 */
	constructor( options = {} ) {

		super();

		const { radius = 1, falloff = true } = options;
		this.radius = uniform( radius );
		this.falloff = uniform( falloff ? 1 : 0, 'uint' );

	}

	updateFunctions() {

		super.updateFunctions();

		const { structs, fns, radius, falloff } = this;
		structs.material = aoMaterialStruct;
		structs.surfaceRecord = aoSurfaceRecordStruct;

		const getUvFromChannel = contextProxyFn( 'bvhData.fns.getUvFromChannel' );
		const getColor = contextProxyFn( 'bvhData.fns.getColor' );

		// the shading normal for the hemisphere, the opacity for alpha tested surfaces, and the hit's
		// occlusion as its emission
		fns.getSurfaceRecord = wgslTagFn/* wgsl */`

			fn getSurfaceRecord(
				material: ${ structs.material },
				objectColor: vec4f,
				vertexData: ${ contextProxy( 'bvhData.structs.attributes' ) },
				hit: ${ hitRecordStruct },
				view: vec3f,
				blurRoughness: f32,
			) -> ${ structs.surfaceRecord } {

				let side = hit.side;
				let faceNormal = hit.normal;

				// "faceNormal" is provided on the hit side so flip it back to the geometric side
				var normal = faceNormal * side;
				if ( material.flatShading == 0 ) {

					normal = normalize( vertexData.normal.xyz );

				}

				// some provided tangents can be malformed (0, 0, 0) causing the normal to be degenerate
				if ( material.normalMap != -1 && length( vertexData.tangent.xyz ) > 0.0 && vertexData.tangent.w != 0.0 ) {

					let tangent = normalize( vertexData.tangent.xyz );
					let bitangent = normalize( cross( normal, tangent ) * vertexData.tangent.w );
					let vTBN = mat3x3f( tangent, bitangent, normal );

					let uvPrime = material.normalMapTransform * vec3( ${ getUvFromChannel }( vertexData, material.normalMap ), 1.0 );
					var texNormal = ${ fns.sampleTexel }( uvPrime.xy, material.normalMap, 0 ).xyz;
					texNormal = texNormal * 2.0 - 1.0;
					texNormal = texNormal * vec3f( material.normalScale, 1.0 );
					normal = normalize( vTBN * texNormal );

				}

				normal *= side;
				normal = ${ ensureValidViewNormal }( normal, faceNormal, view );
				normal = ${ ensureValidReflectionNormal }( normal, faceNormal, view );

				var opacity = material.opacity * objectColor.a;
				if ( material.vertexColors == 1 ) {

					opacity *= ${ getColor }( vertexData ).a;

				}

				if ( material.map != -1 ) {

					let uvPrime = material.mapTransform * vec3f( ${ getUvFromChannel }( vertexData, material.map ), 1 );
					opacity *= ${ fns.sampleTexel }( uvPrime.xy, material.map, 0 ).a;

				}

				if ( material.alphaMap != -1 ) {

					let uvPrime = material.alphaMapTransform * vec3f( ${ getUvFromChannel }( vertexData, material.alphaMap ), 1 );
					opacity *= ${ fns.sampleTexel }( uvPrime.xy, material.alphaMap, 0 ).g;

				}

				// occluders past the radius count as open
				var occlusion = step( ${ radius }, hit.dist );
				if ( ${ falloff } != 0u ) {

					occlusion = smoothstep( 0.0, ${ radius }, hit.dist );

				}

				var surf: ${ structs.surfaceRecord };
				surf.normal = normal;
				surf.frontFace = true;
				surf.thinWall = true;
				surf.color = vec3f( 1.0 );
				surf.emission = vec3f( occlusion );
				surf.roughness = 1.0;
				surf.opacity = select( 1.0, opacity, material.transparent != 0 );
				return surf;

			}

		`;

		// no light is gathered or scattered from the hit, the emission above is the whole result
		fns.bsdfSample = wgslTagFn/* wgsl */`

			fn aoBsdfSample( hit: ${ hitRecordStruct }, surf: ${ structs.surfaceRecord }, worldWo: vec3f ) -> ${ scatterRecordStruct } {

				var record: ${ scatterRecordStruct };
				record.color = vec3f( 0.0 );
				record.pdf = 0.0;
				record.direction = worldWo;
				return record;

			}

		`;

		fns.bsdfEvalPdf = wgslTagFn/* wgsl */`

			fn aoBsdfEvalPdf( hit: ${ hitRecordStruct }, surf: ${ structs.surfaceRecord }, worldWo: vec3f, worldWi: vec3f ) -> ${ scatterRecordStruct } {

				var record: ${ scatterRecordStruct };
				record.color = vec3f( 0.0 );
				record.pdf = 0.0;
				record.direction = worldWi;
				return record;

			}

		`;

	}

	writeMaterialsBuffer( materials ) {

		// NOTE: make the minimum material buffer length 2 in order to avoid TSL converting it to a scalar
		const length = aoMaterialStruct.getLength();
		const floatArray = new Float32Array( Math.max( materials.length, 2 ) * length );
		const intArray = new Int32Array( floatArray.buffer );
		for ( let i = 0, l = materials.length; i < l; i ++ ) {

			const m = materials[ i ];
			let index = i * length;

			// offset 0
			intArray[ index ++ ] = this.getTextureDescriptor( m, 'map' );
			intArray[ index ++ ] = this.getTextureDescriptor( m, 'alphaMap' );
			intArray[ index ++ ] = this.getTextureDescriptor( m, 'normalMap' );
			intArray[ index ++ ] = Number( m.vertexColors );

			// offset 4
			// every surface is double sided so rays leaving through the back of a surface still count as blocked
			floatArray[ index ++ ] = m.opacity;
			floatArray[ index ++ ] = m.alphaTest;
			floatArray[ index ++ ] = 0;
			intArray[ index ++ ] = Number( m.transparent );

			// offset 8
			intArray[ index ++ ] = Number( m.flatShading );
			index ++;
			floatArray[ index ++ ] = 'normalScale' in m ? m.normalScale.x : 1;
			floatArray[ index ++ ] = 'normalScale' in m ? m.normalScale.y : 1;

			// offset 12
			index += this.writeTextureMatrixToArray( m, 'map', floatArray, index );
			index += this.writeTextureMatrixToArray( m, 'alphaMap', floatArray, index );
			index += this.writeTextureMatrixToArray( m, 'normalMap', floatArray, index );

		}

		return { materialData: intArray };

	}

}
