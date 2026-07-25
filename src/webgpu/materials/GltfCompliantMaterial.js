import { texture, textureStore, globalId, float } from 'three/tsl';
import { StorageTexture, RedFormat, LinearFilter, TextureLoader, HalfFloatType } from 'three/webgpu';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { PathtracingMaterial } from './PathtracingMaterial';
import { specularBrdfFunc, diffuseBrdfFunc, fresnelMixFunc, conductorFresnelFunc, albedoIntegralMetallic, fresnelCoatFunc, iridescentDielectricLayerFunc, iridescentConductorLayerFunc } from '../nodes/material.wgsl.js';
import { sheenColorFunc, sheenAlbedoScalingFunc } from '../nodes/sheen.wgsl.js';
import { diffuseDirectionFunc, getLobeWeightsFunc } from '../nodes/sampling.wgsl.js';
import { ggxDirectionFunc, ggxReflectionAdjustedPDFFunc } from '../nodes/ggx.wgsl.js';
import { bxdfContextStruct, scatterRecordStruct, surfaceRecordStruct } from '../nodes/structs.wgsl.js';
import { rand1, rand2, RNG_INDEX_SCATTER_DIRECTION, RNG_INDEX_SCATTER_TYPE } from '../nodes/random.wgsl.js';
import { ComputeKernel } from '../compute/ComputeKernel';

const TURQUIN_METAL_URL = new URL( '../../textures/turquinMetal.png', import.meta.url ).toString();
const TURQUIN_METAL_TEXTURE = await new TextureLoader().loadAsync( TURQUIN_METAL_URL );

const CLEARCOAT_IOR = float( 1.5 );
const MIN_INCIDENT_COS = float( 1e-3 );

export class GltfCompliantMaterial extends PathtracingMaterial {

	constructor( options = {} ) {

		super();

		const {
			specularBrdf = specularBrdfFunc,
			diffuseBrdf = diffuseBrdfFunc,
			fresnelMix = fresnelMixFunc,
			conductorFresnel = conductorFresnelFunc,
			fresnelCoat = fresnelCoatFunc,
			iridescentDielectricLayer = iridescentDielectricLayerFunc,
			iridescentConductorLayer = iridescentConductorLayerFunc,
			calculateTurquinTexture = false,
		} = options;

		if ( calculateTurquinTexture ) {

			this.turquinTexture = new StorageTexture( 32, 32 );
			this.turquinTexture.type = HalfFloatType;

		} else {

			this.turquinTexture = TURQUIN_METAL_TEXTURE;
			this.turquinTexture.flipY = false;

		}

		this.turquinTexture.format = RedFormat;
		this.turquinTexture.minFilter = LinearFilter;
		this.turquinTexture.magFilter = LinearFilter;

		const turquinNode = texture( this.turquinTexture ).setName( 'turquinTexture' );

		this.specularBrdf = specularBrdf;
		this.diffuseBrdf = diffuseBrdf;
		this.fresnelMix = fresnelMix;
		this.conductorFresnel = conductorFresnel( turquinNode );
		this.fresnelCoat = fresnelCoat;
		this.iridescentDielectricLayer = iridescentDielectricLayer;
		this.iridescentConductorLayer = iridescentConductorLayer;
		this.calculateTurquinTexture = calculateTurquinTexture;

	}

	init( renderer ) {

		if ( ! this.calculateTurquinTexture ) {

			return;

		}

		const turquinParams = {
			texture: textureStore( this.turquinTexture ).toWriteOnly(),
			globalId,
		};
		const turquinKernel = new ComputeKernel( albedoIntegralMetallic( turquinParams ), { workgroupSize: [ 16, 16, 1 ] } );

		renderer.compute( turquinKernel.kernel, [ 2, 2, 1 ] );

	}

	getBsdfNode() {

		const bsdfEvalFunc = this._bsdfEvalFunc = wgslTagFn/* wgsl */`

			fn bsdfEval( ctx: ${ bxdfContextStruct }, surf: ${ surfaceRecordStruct } ) -> vec3f {

				// anisotropic roughness along tangent, bitangent
				let alphaB = surf.roughness * surf.roughness;
				let alphaT = mix( alphaB, 1.0, surf.anisotropy * surf.anisotropy );
				let alpha = vec2( alphaT, alphaB );

				let NdotV = ctx.V.z;
				let NdotVc = ctx.Vc.z;
				let NdotL = ctx.L.z;

				let specular = ${ this.specularBrdf }( ctx.V, ctx.L, ctx.H, alpha );
				let diffuse = ${ this.diffuseBrdf }( NdotV, NdotL, ctx.VdotH, surf );
				let dielectricBase = ${ this.fresnelMix }( ctx.VdotH, surf.specularColor, surf.ior, surf.specularIntensity, diffuse, specular );

				let dielectric = ${ this.iridescentDielectricLayer }(
					dielectricBase, diffuse, specular, ctx.VdotH, /* outsideIor */ 1.0,
					surf.ior, surf.iridescenceIor, surf.iridescenceThickness, surf.iridescence
				);

				// TODO: this only handles non-anisotropic surfaces
				let metallicBase = ${ this.conductorFresnel }( NdotV, ctx.VdotH, surf.color, specular, alpha.y );

				let metallic = ${ this.iridescentConductorLayer }(
					metallicBase, specular, surf.color, ctx.VdotH, /* outsideIor */ 1.0,
					surf.iridescenceIor, surf.iridescenceThickness, surf.iridescence
				);

				let baseMaterial = mix( dielectric, metallic, surf.metalness );

				// sheen
				let sheenScale = mix( 1.0, ${ sheenAlbedoScalingFunc }( ctx.V, ctx.L, surf ), surf.sheen );
				let material = baseMaterial * sheenScale + ${ sheenColorFunc }( ctx.V, ctx.L, ctx.H, surf ) * surf.sheen;

				let clearcoatAlpha = surf.clearcoatRoughness * surf.clearcoatRoughness;
				let clearcoat = ${ this.specularBrdf }( ctx.Vc, ctx.Lc, ctx.Hc, vec2( clearcoatAlpha ) );

				let coatedMaterial = ${ this.fresnelCoat }( max( NdotVc, ${ MIN_INCIDENT_COS } ), ${ CLEARCOAT_IOR }, material, clearcoat, surf.clearcoat );

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

	// Evaluates the BSDF and its sampling pdf for an arbitrary light direction ( both world space ).
	// Used by next event estimation to weight a chosen light/environment direction. Shares the same
	// bsdfEval and lobe-mixture pdf as bsdfSample so MIS weights stay consistent.
	getBsdfEvalPdfNode() {

		if ( ! this._bsdfEvalFunc ) {

			this.getBsdfNode();

		}

		const bsdfEvalFunc = this._bsdfEvalFunc;

		return wgslTagFn/* wgsl */`

			fn bsdfEvalPdf( worldWo: vec3f, worldWi: vec3f, surf: ${ surfaceRecordStruct } ) -> ${ scatterRecordStruct } {

				var result: ${ scatterRecordStruct };
				result.pdf = 0.0;
				result.color = vec3f( 0.0 );
				result.direction = worldWi;

				// anisotropic roughness along tangent, bitangent
				let alphaB = surf.roughness * surf.roughness;
				let alphaT = mix( alphaB, 1.0, surf.anisotropy * surf.anisotropy );
				let alpha = vec2( alphaT, alphaB );
				let clearcoatAlpha = surf.clearcoatRoughness * surf.clearcoatRoughness;

				let invBasis = surf.normalInvBasis;
				let invClearcoatBasis = surf.clearcoatInvBasis;

				let wo = normalize( invBasis * worldWo );
				let wi = normalize( invBasis * worldWi );
				let woClearcoat = normalize( invClearcoatBasis * worldWo );
				let wiClearcoat = normalize( invClearcoatBasis * worldWi );

				// reject directions on the far side of the surface
				if ( wo.z < 0.0 || woClearcoat.z < 0.0 || wi.z <= 0.0 ) {

					return result;

				}

				let wh = normalize( wo + wi );
				let whClearcoat = normalize( woClearcoat + wiClearcoat );

				let weights = ${ getLobeWeightsFunc }( wo, woClearcoat, vec3( 0, 0, 1 ), ${ CLEARCOAT_IOR }, surf );

				// pdf of having sampled this direction - must match the lobe mixture in bsdfSample
				if ( weights.diffuse > 0.0 ) {

					result.pdf += weights.diffuse * max( wi.z, 0.0 ) / PI;

				}

				if ( weights.specular > 0.0 ) {

					result.pdf += weights.specular * ${ ggxReflectionAdjustedPDFFunc }( wo, wh, alpha );

				}

				if ( weights.clearcoat > 0.0 && wiClearcoat.z > 0.0 ) {

					result.pdf += weights.clearcoat * ${ ggxReflectionAdjustedPDFFunc }( woClearcoat, whClearcoat, vec2( clearcoatAlpha ) );

				}

				var ctx: ${ bxdfContextStruct };
				ctx.V = wo;
				ctx.L = wi;
				ctx.H = wh;
				ctx.VdotH = saturate( dot( wo, wh ) );
				ctx.Vc = woClearcoat;
				ctx.Lc = wiClearcoat;
				ctx.Hc = whClearcoat;

				result.color = ${ bsdfEvalFunc }( ctx, surf ) * max( 0.0, wi.z );

				return result;

			}

		`;

	}

}
