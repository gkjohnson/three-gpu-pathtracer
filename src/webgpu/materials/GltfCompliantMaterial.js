import { float } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { PathtracingMaterial } from './PathtracingMaterial';
import { specularBrdfFunc, lambertBrdfFunc, fresnelMixFunc, conductorFresnelFunc, fresnelCoatFunc, iridescentDielectricLayerFunc, iridescentConductorLayerFunc } from '../nodes/material.wgsl.js';
import { diffuseDirectionFunc, getLobeWeightsFunc } from '../nodes/sampling.wgsl.js';
import { ggxDirectionFunc, ggxReflectionAdjustedPDFFunc } from '../nodes/ggx.wgsl.js';
import { bxdfContextStruct, scatterRecordStruct, surfaceRecordStruct } from '../nodes/structs.wgsl.js';
import { rand1, rand2, RNG_INDEX_SCATTER_DIRECTION, RNG_INDEX_SCATTER_TYPE } from '../nodes/random.wgsl.js';
import { TurquinTexture } from '../TurquinTexture.js';

const CLEARCOAT_IOR = float( 1.5 );
const MIN_INCIDENT_COS = float( 1e-3 );

export class GltfCompliantMaterial extends PathtracingMaterial {

	constructor( options = {} ) {

		super();

		const {
			specularBrdf = specularBrdfFunc,
			diffuseBrdf = lambertBrdfFunc,
			fresnelMix = fresnelMixFunc,
			conductorFresnel = conductorFresnelFunc,
			fresnelCoat = fresnelCoatFunc,
			iridescentDielectricLayer = iridescentDielectricLayerFunc,
			iridescentConductorLayer = iridescentConductorLayerFunc,
		} = options;

		this.turquinTexture = new TurquinTexture();
		this.specularBrdf = specularBrdf;
		this.diffuseBrdf = diffuseBrdf;
		this.fresnelMix = fresnelMix;
		this.conductorFresnel = conductorFresnel;
		this.fresnelCoat = fresnelCoat;
		this.iridescentDielectricLayer = iridescentDielectricLayer;
		this.iridescentConductorLayer = iridescentConductorLayer;

	}

	init( renderer ) {

		this.turquinTexture.generate( renderer );

	}

	getBsdfNode() {

		const bsdfEvalFunc = wgslTagFn/* wgsl */`

			fn bsdfEval( ctx: ${ bxdfContextStruct }, surf: ${ surfaceRecordStruct } ) -> vec3f {

				// anisotropic roughness along tangent, bitangent
				let alphaB = surf.roughness * surf.roughness;
				let alphaT = mix( alphaB, 1.0, surf.anisotropy * surf.anisotropy );
				let alpha = vec2( alphaT, alphaB );

				let NdotV = ctx.V.z;
				let NdotVc = ctx.Vc.z;
				let NdotL = ctx.L.z;

				// account for multi scatter energy loss for specular
				let energySs =  max( ${ this.turquinTexture.sampleConductorFn }( NdotV, surf.roughness ), 1e-5 );
				let specular = ${ this.specularBrdf }( ctx.V, ctx.L, ctx.H, alpha );
				let diffuse = ${ this.diffuseBrdf }( NdotV, NdotL, ctx.VdotH, surf );

				// Turquin multiscatter energy compensation term: 1 + f0 * ( 1 - E ) / E
				// This simplifies to 1.0 / E for dielectric (f0 = 1.0)
				let dielectricComp = 1.0 / energySs;
				let dielectricSpecular = specular * dielectricComp;
				let dielectricBase = ${ this.fresnelMix }( ctx.VdotH, surf.ior, diffuse, dielectricSpecular );

				let dielectric = ${ this.iridescentDielectricLayer }(
					dielectricBase, diffuse, specular, ctx.VdotH, /* outsideIor */ 1.0,
					surf.ior, surf.iridescenceIor, surf.iridescenceThickness, surf.iridescence
				);

				// metal: Fresnel-weighted specular with the multiscatter comp
				let metallicEnergySs = max( ${ this.turquinTexture.sampleConductorFn }( NdotV, surf.roughness ), 1e-5 );
				let metallicComp = 1.0 + surf.color * ( 1.0 - metallicEnergySs ) / metallicEnergySs;
				let metallicSpecular = specular * metallicComp;
				let metallicBase = ${ this.conductorFresnel }( ctx.VdotH, surf.color, metallicSpecular );
				let metallic = ${ this.iridescentConductorLayer }(
					metallicBase, metallicSpecular, surf.color, ctx.VdotH, /* outsideIor */ 1.0,
					surf.iridescenceIor, surf.iridescenceThickness, surf.iridescence
				);

				let material = mix( dielectric, metallic, surf.metalness );

				let clearcoatAlpha = surf.clearcoatRoughness * surf.clearcoatRoughness;
				let clearcoatEnergySS = max( ${ this.turquinTexture.sampleConductorFn }( NdotVc, surf.clearcoatRoughness ), 1e-5 );
				let clearcoatComp = 1.0 / clearcoatEnergySS;
				let clearcoatSpecular = ${ this.specularBrdf }( ctx.Vc, ctx.Lc, ctx.Hc, vec2( clearcoatAlpha ) ) * clearcoatComp;

				let coatedMaterial = ${ this.fresnelCoat }( max( NdotVc, ${ MIN_INCIDENT_COS } ), ${ CLEARCOAT_IOR }, material, clearcoatSpecular, surf.clearcoat );

				return coatedMaterial;

			}

		`;

		return wgslTagFn/* wgsl */`

			fn bsdfSample( worldWo: vec3f, surf: ${ surfaceRecordStruct } ) -> ${ scatterRecordStruct } {

				var result: ${ scatterRecordStruct };
				result.pdf = 0.0;

				// anisotropic roughness along tangent, bitangent
				let alphaB = surf.roughness * surf.roughness;
				let alphaT = mix( alphaB, 1.0, surf.anisotropy * surf.anisotropy );
				let alpha = vec2( alphaT, alphaB );

				let clearcoatAlpha = surf.clearcoatRoughness * surf.clearcoatRoughness;

				let normalBasis = surf.normalBasis;
				let invBasis = surf.normalInvBasis;
				let clearcoatBasis = surf.clearcoatBasis;
				let invClearcoatBasis = surf.clearcoatInvBasis;

				let wo = normalize( invBasis * worldWo );
				let woClearcoat = normalize( invClearcoatBasis * worldWo );

				// TODO: handle such intersections better;
				// Sometimes .z < 0.0 on a pretty round surface e.g. sphere
				// Disabling this condition leads to more fireflies on ClearCoatCarPaint example
				// This could also be fixed by offsetting rays by 1e-1
				// Also, this will be an invalid condition when transmission is implemented
				if ( wo.z < 0.0 || woClearcoat.z < 0.0 ) {

					return result;

				}

				let weights = ${ getLobeWeightsFunc }( wo, woClearcoat, vec3( 0, 0, 1 ), ${ CLEARCOAT_IOR }, surf );

				var cdf: vec4f;
				cdf.x = weights.diffuse;
				cdf.y = weights.specular + cdf.x;
				cdf.z = weights.clearcoat + cdf.y;
				cdf.w = 0; // weights.transmission + cdf.z;

				let r = ${ rand1 }( ${ RNG_INDEX_SCATTER_TYPE } ) * cdf.z;

				let directionUV = ${ rand2 }( ${ RNG_INDEX_SCATTER_DIRECTION } );
				var wi: vec3f;
				var wiClearcoat: vec3f;
				var wh: vec3f;
				var whClearcoat: vec3f;

				if ( r <= cdf.x ) { // diffuse

					wi = ${ diffuseDirectionFunc }( wo, directionUV );
					wh = normalize( wi + wo );

					wiClearcoat = normalize( invClearcoatBasis * normalBasis * wi );
					whClearcoat = normalize( invClearcoatBasis * normalBasis * wh );

				} else if ( r <= cdf.y ) { // specular

					wh = ${ ggxDirectionFunc }( wo, alpha, directionUV );
					wi = - normalize( reflect( wo, wh ) );

					wiClearcoat = normalize( invClearcoatBasis * normalBasis * wi );
					whClearcoat = normalize( invClearcoatBasis * normalBasis * wh );

				} else if ( r <= cdf.z ) { // clearcoat

					whClearcoat = ${ ggxDirectionFunc }( woClearcoat, vec2( clearcoatAlpha ), directionUV );
					wiClearcoat = - normalize( reflect( woClearcoat, whClearcoat ) );

					wi = normalize( invBasis * clearcoatBasis * wiClearcoat );
					wh = normalize( invBasis * clearcoatBasis * whClearcoat );

				} else if ( r <= cdf.w ) { // transmission / refraction

					// NOT IMPLEMENTED

				}

				var ctx: ${ bxdfContextStruct };
				ctx.V = wo;
				ctx.L = wi;
				ctx.H = wh;

				ctx.VdotH = saturate( dot( wo, wh ) );

				ctx.Vc = woClearcoat;
				ctx.Lc = wiClearcoat;
				ctx.Hc = whClearcoat;

				if ( weights.diffuse > 0.0 ) {

					result.pdf += weights.diffuse * max( wi.z, 0.0 ) / PI;

				}

				if ( weights.specular > 0.0 && wi.z > 0.0 ) {

					result.pdf += weights.specular * ${ ggxReflectionAdjustedPDFFunc }( wo, wh, alpha );

				}

				if ( weights.clearcoat > 0.0 && wiClearcoat.z > 0.0 ) {

					result.pdf += weights.clearcoat * ${ ggxReflectionAdjustedPDFFunc }( woClearcoat, whClearcoat, vec2( clearcoatAlpha ) );

				}

				result.color = ${ bsdfEvalFunc }( ctx, surf );
				result.color *= max( 0.0, wi.z );
				result.direction = normalize( normalBasis * wi );

				return result;

			}

		`;

	}

}
