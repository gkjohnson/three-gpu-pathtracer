import { texture, textureStore, globalId, float, vec2 } from 'three/tsl';
import { StorageTexture, RedFormat, LinearFilter, TextureLoader, HalfFloatType } from 'three/webgpu';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { PathtracingMaterial } from './PathtracingMaterial.js';
import { specularBrdfFunc, specularBtdfFunc, diffuseBrdfFunc, fresnelMixFunc, conductorFresnelFunc, albedoIntegralMetallic, fresnelCoatFunc, iridescentDielectricLayerFunc, iridescentConductorLayerFunc, thinWallTransmissionRoughnessFunc } from '../nodes/material.wgsl.js';
import { dielectricFresnelFunc } from '../nodes/utils.wgsl.js';
import { sheenColorFunc, sheenAlbedoScalingFunc } from '../nodes/sheen.wgsl.js';
import { diffuseDirectionFunc, getLobeWeightsFunc } from '../nodes/sampling.wgsl.js';
import { ggxDirectionFunc, ggxReflectionAdjustedPDFFunc, ggxRefractionAdjustedPDFFunc } from '../nodes/ggx.wgsl.js';
import { bxdfContextStruct, scatterRecordStruct, surfaceRecordStruct } from '../nodes/structs.wgsl.js';
import { rand1, rand2, RNG_INDEX_SCATTER_DIRECTION, RNG_INDEX_SCATTER_TYPE } from '../nodes/random.wgsl.js';
import { ComputeKernel } from '../compute/ComputeKernel.js';

const TURQUIN_METAL_URL = new URL( '../../textures/turquinMetal.png', import.meta.url ).toString();
const TURQUIN_METAL_TEXTURE = new TextureLoader().load( TURQUIN_METAL_URL );

const CLEARCOAT_IOR = float( 1.5 );
const MIN_INCIDENT_COS = float( 1e-3 );

export class GltfCompliantMaterial extends PathtracingMaterial {

	constructor( options = {} ) {

		super();

		const {
			specularBrdf = specularBrdfFunc,
			specularBtdf = specularBtdfFunc,
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

		const turquinNode = texture( this.turquinTexture, vec2( 0.0 ) ).setName( 'turquinTexture' );

		this.specularBrdf = specularBrdf;
		this.specularBtdf = specularBtdf;
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

		const bsdfEvalFunc = wgslTagFn/* wgsl */`

			fn bsdfEval( ctx: ${ bxdfContextStruct }, surf: ${ surfaceRecordStruct } ) -> vec3f {

				// anisotropic roughness along tangent, bitangent
				let alphaB = surf.roughness * surf.roughness;
				let alphaT = mix( alphaB, 1.0, surf.anisotropy * surf.anisotropy );
				let alpha = vec2( alphaT, alphaB );

				let NdotV = ctx.V.z;
				let NdotVc = ctx.Vc.z;
				let NdotL = ctx.L.z;

				// transmitted directions only gather the refracted lobe — the reflection lobes are
				// gated to the upper hemisphere, matching the WebGL implementation
				if ( NdotL < 0.0 ) {

					// TODO: transmitted light also crosses the thin film so it should be weighted by
					// the film-aware fresnel complement (1 - filmF) rather than the plain dielectric
					// fresnel, tinting transmission with the film's complementary color. Deferred until
					// the material is generalized into a layer stack that owns the fresnel per interface.
					var refraction: vec3f;
					if ( surf.thinWall ) {

						// evaluate the flipped reflection
						let wiMirror = vec3f( ctx.L.xy, - ctx.L.z );
						let thinWallAlpha = vec2f( ${ thinWallTransmissionRoughnessFunc }( alphaB, surf.ior ) );
						let F = ${ dielectricFresnelFunc }( saturate( ctx.VdotH ), surf.eta );
						refraction = ( 1.0 - F ) * ${ this.specularBrdf }( ctx.V, wiMirror, ctx.H, thinWallAlpha );

					} else {

						refraction = ${ this.specularBtdf }( ctx.V, ctx.L, ctx.H, alpha, surf.eta );

					}

					return ( 1.0 - surf.metalness ) * surf.transmission * refraction * surf.color;

				}

				let specular = ${ this.specularBrdf }( ctx.V, ctx.L, ctx.H, alpha );
				let reflection = ${ this.diffuseBrdf }( NdotV, NdotL, ctx.VdotH, surf );
				let diffuse = ( 1.0 - surf.transmission ) * reflection;
				let dielectricBase = ${ this.fresnelMix }( ctx.VdotH, surf.specularColor, surf.ior, surf.eta, surf.specularIntensity, diffuse, specular );

				// the media on either side of the film - air outside and the volume interior
				// as the base on front faces, swapped on back faces so TIR can take effect
				let outsideIor = select( surf.ior, 1.0, surf.frontFace );
				let filmBaseIor = select( 1.0, surf.ior, surf.frontFace );

				let dielectric = ${ this.iridescentDielectricLayer }(
					dielectricBase, diffuse, specular, ctx.VdotH, outsideIor,
					filmBaseIor, surf.iridescenceIor, surf.iridescenceThickness, surf.iridescence
				);

				// TODO: this only handles non-anisotropic surfaces
				let metallicBase = ${ this.conductorFresnel }( NdotV, ctx.VdotH, surf.color, specular, alpha.y );

				let metallic = ${ this.iridescentConductorLayer }(
					metallicBase, specular, surf.color, ctx.VdotH, outsideIor,
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

				let weights = ${ getLobeWeightsFunc }( wo, wo, woClearcoat, vec3( 0, 0, 1 ), ${ CLEARCOAT_IOR }, surf );

				var cdf: vec4f;
				cdf.x = weights.diffuse;
				cdf.y = weights.specular + cdf.x;
				cdf.z = weights.clearcoat + cdf.y;
				cdf.w = weights.transmission + cdf.z;

				let r = ${ rand1 }( ${ RNG_INDEX_SCATTER_TYPE } ) * cdf.w;

				let directionUV = ${ rand2 }( ${ RNG_INDEX_SCATTER_DIRECTION } );
				var wi: vec3f;
				var wiClearcoat: vec3f;
				var wh: vec3f;
				var whClearcoat: vec3f;
				var isTransmissive = false;

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

					isTransmissive = true;

					if ( surf.thinWall ) {

						// model the double refraction as a single reflection flipped through the surface
						let thinWallAlpha = vec2f( ${ thinWallTransmissionRoughnessFunc }( alphaB, surf.ior ) );
						wh = ${ ggxDirectionFunc }( wo, thinWallAlpha, directionUV );
						wi = - normalize( reflect( wo, wh ) );
						wi = vec3f( wi.xy, - wi.z );

					} else {

						wh = ${ ggxDirectionFunc }( wo, alpha, directionUV );
						wi = refract( - wo, wh, surf.eta );

						if ( all( wi == vec3f( 0.0 ) ) ) {

							// total internal reflection - refract returns a zero vector, so bounce the
							// ray off the inside of the surface instead of terminating it
							wi = - normalize( reflect( wo, wh ) );

						}

					}

					wiClearcoat = normalize( invClearcoatBasis * normalBasis * wi );
					whClearcoat = normalize( invClearcoatBasis * normalBasis * wh );

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

				if ( weights.transmission > 0.0 && wi.z < 0.0 ) {

					if ( surf.thinWall ) {

						// the flipped reflection shares the reflection pdf
						let thinWallAlpha = vec2f( ${ thinWallTransmissionRoughnessFunc }( alphaB, surf.ior ) );
						result.pdf += weights.transmission * ${ ggxReflectionAdjustedPDFFunc }( wo, wh, thinWallAlpha );

					} else {

						result.pdf += weights.transmission * ${ ggxRefractionAdjustedPDFFunc }( wo, wi, wh, alpha, surf.eta );

					}

				}

				result.color = ${ bsdfEvalFunc }( ctx, surf ) * select( max( 0.0, wi.z ), abs( wi.z ), isTransmissive );
				result.direction = normalize( normalBasis * wi );
				result.isTransmissive = isTransmissive;

				// Flip the scattered ray through the surface if it lands on the wrong side of the
				// geometry due to the shading normal - reflected rays must leave above the surface
				// and transmitted rays below it
				let scatterNormal = surf.faceNormal * select( 1.0, - 1.0, isTransmissive );
				let geomDotDir = dot( result.direction, scatterNormal );
				if ( geomDotDir < 0.0 ) {

					result.direction = normalize( result.direction - 2.0 * geomDotDir * scatterNormal );

				}

				return result;

			}

		`;

	}

}
