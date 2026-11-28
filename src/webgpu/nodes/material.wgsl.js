import { ColorManagement, LinearSRGBColorSpace } from 'three/webgpu';
import { wgslFn, mat3 } from 'three/tsl';
import {
	inverseMat3x3Func,
	getBasisFromNormalFunc,
	iorToF0Func,
	schlickFresnelFunc,
	schlickFresnelVecFunc,
	iorToF0GeneralFunc,
	fresnel0ToIorFunc,
	iorToF0GeneralVecFunc,
	dielectricFresnelFunc,
	totalInternalReflectionFunc,
	totalInternalReflectionVecFunc,
} from './utils.wgsl.js';
import {
	ggxSmithVisibilityFunc,
	ggxDistributionFunc,
	ggxDirectionFunc,
	ggxReflectionAdjustedPDFFunc,
	ggxRefractionAdjustedPDFFunc,
	ggxShadowMaskG1Func,
} from './ggx.wgsl.js';
import { constants, hitRecordStruct, surfaceRecordStruct, transmissionFresnelStruct } from './structs.wgsl.js';
import { wgslTagFn, contextProxy, contextProxyFn } from 'three-mesh-bvh/webgpu';
import { ifFeature } from './features.js';

const evaluateMaterialGraph = /* @__PURE__ */ contextProxyFn( 'shadingModel.materialGraphs.evaluateFn' );

// Correct the shading normal to prevent scattering rays below the geometry surface by bending
// the normal towards the geometry normal such that the perfect reflection ray is just above the
// geometry surface. Ported verbatim from Blender Cycles "ensure_valid_specular_reflection"
// (src/kernel/closure/bsdf_util.h), which is derived from from the Iray paper (Keller et al. 2017, A.3).
//
// This only guarantees perfect reflection rays are above surface - other diffuse rays, for example,
// flipped when sampling.
const ensureValidReflectionNormal = wgslTagFn/* wgsl */`

	fn ensureValidReflectionNormal( n: vec3f, ng: vec3f, i: vec3f ) -> vec3f {

		// reflected ray
		let R = 2.0 * dot( n, i ) * n - i;

		let Iz = dot( i, ng );

		// reflection rays may always be at least as shallow as the incoming ray
		let threshold = min( 0.9 * Iz, 0.01 );
		if ( dot( ng, R ) >= threshold ) {

			return n;

		}

		// Form coordinate system with Ng as the Z axis and N inside the X-Z-plane.
   		// The X axis is found by normalizing the component of N that's orthogonal to Ng.
   		// The Y axis isn't actually needed.
		let orthoN = n - dot( n, ng ) * ng;
		let orthoLen = length( orthoN );
		let X = select( n, orthoN / orthoLen, orthoLen != 0.0 );

		// Calculate N.z and N.x in the local coordinate system.
		//
		// The goal of this computation is to find a N' that is rotated towards Ng just enough
   		// to lift R' above the threshold (here called t), therefore dot(R', Ng) = t.
		//
		// See the Blender implementation for a full description of the solution.
		let Ix = dot( i, X );

		let a = Ix * Ix + Iz * Iz;
		let b = 2.0 * ( a + Iz * threshold );
		let c = ( threshold + Iz ) * ( threshold + Iz );

		// only one root is valid; the sign of Ix selects it
		var Nz2: f32;
		if ( Ix < 0.0 ) {

			Nz2 = 0.25 * ( b + sqrt( max( b * b - 4.0 * a * c, 0.0 ) ) ) / a;

		} else {

			Nz2 = 0.25 * ( b - sqrt( max( b * b - 4.0 * a * c, 0.0 ) ) ) / a;

		}

		let Nx = sqrt( max( 1.0 - Nz2, 0.0 ) );
		let Nz = sqrt( max( Nz2, 0.0 ) );

		return Nx * X + Nz * ng;

	}

`;

// Adjusts the shading normal such that the provided view normal is guaranteed to be in
// positive hemisphere by rotating it towards the view direction just enough so view is
// just glancing the surface as a small epsilon if needed.
const ensureValidViewNormal = wgslTagFn/* wgsl */`

	fn ensureValidViewNormal( n: vec3f, ng: vec3f, view: vec3f ) -> vec3f {

		// ensure the view is at least slightly above the surface normal hemisphere
		const MIN_VIEW_COS = 1e-6;

		// if we're positive already then early out
		let c = dot( n, view );
		if ( c > MIN_VIEW_COS ) {

			return n;

		}

		// perpendicular vector to normal and view
		var perp = n - c * view;
		let perpLen = length( perp );

		// if we reach here that means that he view is nearly the opposite direction and
		// we can't derive plan to rotate on towards the view, so just use the geometry
		// normal. This could likely only really happen with a severe normal map application.
		if ( perpLen <= 1e-6 ) {

			return ng;

		}

		perp = perp / perpLen;

		// rotate the normal to be at larger than the above threshold - pythagorean
		// theorem for generating normal with threshold*view component
		return MIN_VIEW_COS * view + sqrt( 1.0 - MIN_VIEW_COS * MIN_VIEW_COS ) * perp;

	}

`;

// Sentinel for a disabled glossy filter ( FLT_MAX, mirroring Cycles ): the blur term
// clamps to zero for any path pdf when the inverted filter value is this large.
export const FILTER_GLOSSY_DISABLED = 3.402823466e38;

// Builds getSurfaceRecord from the given structs, texture sampling and vertex data lookups
export const getSurfaceRecordFunc = ( {
	materialStruct,
	surfaceRecordStruct,
	attributesStruct,
	getVertex,
	objectsStorage,
	sampleTexel,
	getTextureSize,
	getUvFromChannel,
	getColor,
} ) => wgslTagFn/* wgsl */`
	${ [ constants ] }
	fn getSurfaceRecord(
		material: ${ materialStruct },
		objectColor: vec4f,
		vertexData: ${ attributesStruct },
		hit: ${ hitRecordStruct },
		view: vec3f,
		blurRoughness: f32,
	) -> ${ surfaceRecordStruct } {

		let side = hit.side;
		let faceNormal = hit.normal;

		// "faceNormal" is provided on the hit side so flip it back to the geometric side
		var normal = faceNormal * side;
		if ( material.flatShading == 0 ) {

			normal = normalize( vertexData.normal.xyz );

		}

		var baseNormal = normal;
		if ( material.normalMap != -1 ) {

			// some provided tangents can be malformed (0, 0, 0) causing the normal to be degenerate
			// resulting in NaNs and slow path tracing.
			if ( length( vertexData.tangent.xyz ) > 0.0 && vertexData.tangent.w != 0.0 ) {

				// TODO: consider re-orthonormalizing against the normal here since attribute
				// interpolation could result in drift.
				let tangent = normalize( vertexData.tangent.xyz );
				let bitangent = normalize( cross( baseNormal, tangent ) * vertexData.tangent.w );
				let vTBN = mat3x3f( tangent, bitangent, baseNormal );

				let uvPrime = material.normalMapTransform * vec3( ${ getUvFromChannel }( vertexData,material.normalMap ), 1.0 );
				var texNormal = ${ sampleTexel }( uvPrime.xy,material.normalMap, 0 ).xyz;
				texNormal = texNormal * 2.0 - 1.0;
				texNormal = texNormal * vec3f( material.normalScale, 1.0 );
				normal = normalize( vTBN * texNormal );

			}

		} else if ( material.bumpMap != -1 ) {

			// "Bump Mapping Unparametrized Surfaces on the GPU" by Morten S. Mikkelsen, as in three.js, with the
			// triangle's edges in place of the screen-space derivatives
			// https://mmikk.github.io/papers3d/mm_sfgrad_bump.pdf
			let objectInfo = ${ objectsStorage }[ hit.objectIndex ];
			let a0 = ${ getVertex }( hit.indices.x, objectInfo.attributesOffset );
			let a1 = ${ getVertex }( hit.indices.y, objectInfo.attributesOffset );
			let a2 = ${ getVertex }( hit.indices.z, objectInfo.attributesOffset );

			// the triangle's edges in world space, and in the bump map's uv space
			let sigmaX = ( objectInfo.matrixWorld * vec4f( a1.position.xyz - a0.position.xyz, 0.0 ) ).xyz;
			let sigmaY = ( objectInfo.matrixWorld * vec4f( a2.position.xyz - a0.position.xyz, 0.0 ) ).xyz;
			let uv0 = ( material.bumpMapTransform * vec3f( ${ getUvFromChannel }( a0, material.bumpMap ), 1.0 ) ).xy;
			let uv1 = ( material.bumpMapTransform * vec3f( ${ getUvFromChannel }( a1, material.bumpMap ), 1.0 ) ).xy;
			let uv2 = ( material.bumpMapTransform * vec3f( ${ getUvFromChannel }( a2, material.bumpMap ), 1.0 ) ).xy;

			// the height gradient in uv space, with central differences one texel apart
			let uv = ( material.bumpMapTransform * vec3f( ${ getUvFromChannel }( vertexData, material.bumpMap ), 1.0 ) ).xy;
			let texelSize = 1.0 / ${ getTextureSize }( material.bumpMap );
			let dx = vec2f( texelSize.x, 0.0 );
			let dy = vec2f( 0.0, texelSize.y );
			let gradU = ( ${ sampleTexel }( uv + dx, material.bumpMap, 0 ).x - ${ sampleTexel }( uv - dx, material.bumpMap, 0 ).x ) / ( 2.0 * texelSize.x );
			let gradV = ( ${ sampleTexel }( uv + dy, material.bumpMap, 0 ).x - ${ sampleTexel }( uv - dy, material.bumpMap, 0 ).x ) / ( 2.0 * texelSize.y );

			// bumpScale is a height in local units, so it follows the object's scale along the normal
			let scale = material.bumpScale * length( ( transpose( objectInfo.matrixWorld ) * vec4f( baseNormal, 0.0 ) ).xyz );
			let dBx = scale * dot( vec2f( gradU, gradV ), uv1 - uv0 );
			let dBy = scale * dot( vec2f( gradU, gradV ), uv2 - uv0 );

			let R1 = cross( sigmaY, baseNormal );
			let R2 = cross( baseNormal, sigmaX );
			let det = dot( sigmaX, R1 );
			let grad = sign( det ) * ( dBx * R1 + dBy * R2 );
			normal = normalize( abs( det ) * baseNormal - grad );

		}

		normal *= side;

		normal = ${ ensureValidViewNormal }( normal, faceNormal, view );

		normal = ${ ensureValidReflectionNormal }( normal, faceNormal, view );

		// the object and vertex colors tint the material's color, applied after the material graphs
		var albedo = vec4( material.color, material.opacity );
		var tint = objectColor;
		if ( material.vertexColors == 1 ) {

			tint *= ${ getColor }( vertexData );

		}

		if ( material.map != -1 ) {

			let uvPrime = material.mapTransform * vec3f( ${ getUvFromChannel }( vertexData,material.map ), 1 );
			albedo *= ${ sampleTexel }( uvPrime.xy,material.map, 0 );

		}

		if ( material.alphaMap != -1 ) {

			let uvPrime = material.alphaMapTransform * vec3f( ${ getUvFromChannel }( vertexData,material.alphaMap ), 1 );
			albedo.a *= ${ sampleTexel }( uvPrime.xy,material.alphaMap, 0 ).g;

		}

		var roughness = material.roughness;
		if ( material.roughnessMap != -1 ) {

			let uvPrime = material.roughnessMapTransform * vec3f( ${ getUvFromChannel }( vertexData,material.roughnessMap ), 1 );
			let texColor = ${ sampleTexel }( uvPrime.xy,material.roughnessMap, 0 );
			roughness *= texColor.g;

		}

		var metalness = material.metalness;
		if ( material.metalnessMap != -1 ) {

			let uvPrime = material.metalnessMapTransform * vec3f( ${ getUvFromChannel }( vertexData,material.metalnessMap ), 1 );
			let texColor = ${ sampleTexel }( uvPrime.xy,material.metalnessMap, 0 );
			metalness *= texColor.b;

		}

		var emission = material.emissiveIntensity * material.emissive;
		if ( material.emissiveMap != -1 ) {

			let uvPrime = material.emissiveMapTransform * vec3f( ${ getUvFromChannel }( vertexData,material.emissiveMap ), 1 );
			let texColor = ${ sampleTexel }( uvPrime.xy,material.emissiveMap, 0 );
			emission *= texColor.rgb;

		}

		var transmission = material.transmission;
		if ( material.transmissionMap != -1 ) {

			let uvPrime = material.transmissionMapTransform * vec3f( ${ getUvFromChannel }( vertexData,material.transmissionMap ), 1 );
			let texColor = ${ sampleTexel }( uvPrime.xy,material.transmissionMap, 0 );
			transmission *= texColor.r;

		}

		var clearcoat = material.clearcoat;
		if ( material.clearcoatMap != -1 ) {

			let uvPrime = material.clearcoatMapTransform * vec3f( ${ getUvFromChannel }( vertexData,material.clearcoatMap ), 1 );
			let texColor = ${ sampleTexel }( uvPrime.xy,material.clearcoatMap, 0 );
			clearcoat *= texColor.r;

		}

		var clearcoatRoughness = material.clearcoatRoughness;
		if ( material.clearcoatRoughnessMap != -1 ) {

			let uvPrime = material.clearcoatRoughnessMapTransform * vec3f( ${ getUvFromChannel }( vertexData,material.clearcoatRoughnessMap ), 1 );
			let texColor = ${ sampleTexel }( uvPrime.xy,material.clearcoatRoughnessMap, 0 );
			clearcoatRoughness *= texColor.g;

		}

		var clearcoatNormal = baseNormal;
		if ( material.clearcoatNormalMap != -1 ) {

			// some provided tangents can be malformed (0, 0, 0) causing the normal to be degenerate
			// resulting in NaNs and slow path tracing.
			if ( length( vertexData.tangent.xyz ) > 0.0 && vertexData.tangent.w != 0.0 ) {

				// TODO: consider re-orthonormalizing against the normal here since attribute
				// interpolation could result in drift.
				let tangent = normalize( vertexData.tangent.xyz );
				let bitangent = normalize( cross( baseNormal, tangent ) * vertexData.tangent.w );
				let vTBN = mat3x3f( tangent, bitangent, baseNormal );

				let uvPrime = material.clearcoatNormalMapTransform * vec3( ${ getUvFromChannel }( vertexData,material.clearcoatNormalMap ), 1.0 );
				var texNormal = ${ sampleTexel }( uvPrime.xy,material.clearcoatNormalMap, 0 ).xyz;
				texNormal = texNormal * 2.0 - 1.0;
				texNormal = texNormal * vec3f( material.clearcoatNormalScale, 1.0 );
				clearcoatNormal = normalize( vTBN * texNormal );

			}

		}

		clearcoatNormal *= side;

		clearcoatNormal = ${ ensureValidViewNormal }( clearcoatNormal, faceNormal, view );

		clearcoatNormal = ${ ensureValidReflectionNormal }( clearcoatNormal, faceNormal, view );

		var sheenColor = material.sheenColor;
		if ( material.sheenColorMap != -1 ) {

			let uvPrime = material.sheenColorMapTransform * vec3f( ${ getUvFromChannel }( vertexData,material.sheenColorMap ), 1 );
			let texColor = ${ sampleTexel }( uvPrime.xy,material.sheenColorMap, 0 );
			sheenColor *= texColor.rgb;

		}

		var sheenRoughness = material.sheenRoughness;
		if ( material.sheenRoughnessMap != -1 ) {

			let uvPrime = material.sheenRoughnessMapTransform * vec3f( ${ getUvFromChannel }( vertexData,material.sheenRoughnessMap ), 1 );
			let texColor = ${ sampleTexel }( uvPrime.xy,material.sheenRoughnessMap, 0 );
			sheenRoughness *= texColor.a;

		}

		var iridescence = material.iridescence;
		if ( material.iridescenceMap != -1 ) {

			let uvPrime = material.iridescenceMapTransform * vec3f( ${ getUvFromChannel }( vertexData,material.iridescenceMap ), 1 );
			let texColor = ${ sampleTexel }( uvPrime.xy,material.iridescenceMap, 0 );
			iridescence *= texColor.r;

		}

		var iridescenceThickness = material.iridescenceThicknessMaximum;
		if ( material.iridescenceThicknessMap != -1 ) {

			let uvPrime = material.iridescenceThicknessMapTransform * vec3f( ${ getUvFromChannel }( vertexData,material.iridescenceThicknessMap ), 1 );
			let texColor = ${ sampleTexel }( uvPrime.xy,material.iridescenceThicknessMap, 0 );

			iridescenceThickness = mix(
				material.iridescenceThicknessMinimum,
				material.iridescenceThicknessMaximum,
				texColor.g,
			);

		}

		var specularColor = material.specularColor;
		if ( material.specularColorMap != -1 ) {

			let uvPrime = material.specularColorMapTransform * vec3f( ${ getUvFromChannel }( vertexData,material.specularColorMap ), 1 );
			let texColor = ${ sampleTexel }( uvPrime.xy,material.specularColorMap, 0 );
			specularColor *= texColor.rgb;

		}

		var specularIntensity = material.specularIntensity;
		if ( material.specularIntensityMap != -1 ) {

			let uvPrime = material.specularIntensityMapTransform * vec3f( ${ getUvFromChannel }( vertexData,material.specularIntensityMap ), 1 );
			let texColor = ${ sampleTexel }( uvPrime.xy,material.specularIntensityMap, 0 );
			specularIntensity *= texColor.a;

		}

		// extract the anisotropy magnitude vector in tangent space
		var anisotropyDirVec = material.anisotropy * vec2f( cos( material.anisotropyRotation ), sin( material.anisotropyRotation ) );
		if ( material.anisotropyMap != -1 ) {

			let uvPrime = material.anisotropyMapTransform * vec3f( ${ getUvFromChannel }( vertexData,material.anisotropyMap ), 1.0 );
			let aniTex = ${ sampleTexel }( uvPrime.xy,material.anisotropyMap, 0 );

			// map rg encode the direction ([-1,1]), b the strength; rotate + scale by the material anisotropy.
			let mapDir = aniTex.rg * 2.0 - vec2f( 1.0 );
			let mapStr = aniTex.b;
			let mapLen = length( mapDir );
			if ( mapLen > EPSILON ) {

				anisotropyDirVec = mat2x2f(
					anisotropyDirVec.x, anisotropyDirVec.y,
					- anisotropyDirVec.y, anisotropyDirVec.x
				) * mapStr * mapDir / mapLen;

			}

		}

		// adjust the surface basis to be oriented along the anisotropic vector
		let anisotropyStrength = length( anisotropyDirVec );
		var surfaceBasis = ${ getBasisFromNormalFunc }( normal );
		if ( anisotropyStrength > 0.0 && length( vertexData.tangent.xyz ) > 0.0 && vertexData.tangent.w != 0.0 ) {

			let anisotropyDir = anisotropyDirVec / anisotropyStrength;

			// re-orthonormalize the tangent against the shading normal so the frame stays orthonormal -
			// normal map adjustments will cause the normal and tangent to become non-orthonormal.
			let tangent = normalize( vertexData.tangent.xyz - normal * dot( normal, vertexData.tangent.xyz ) );
			let bitangent = cross( normal, tangent ) * vertexData.tangent.w;

			surfaceBasis = mat3x3f(
				tangent * anisotropyDir.x + bitangent * anisotropyDir.y,
				bitangent * anisotropyDir.x - tangent * anisotropyDir.y,
				normal
			);

		}

		var surf: ${ surfaceRecordStruct };

		surf.volumeParticle = false;
		surf.faceNormal = faceNormal;
		surf.normal = normal;

		surf.metalness = metalness;
		surf.diffuseRoughness = material.diffuseRoughness;
		surf.color = albedo.rgb;
		surf.emission = emission;
		surf.opacity = albedo.a;
		surf.roughness = roughness;

		// node material graphs replace the surface values
		// TODO: build three.js' "setupDiffuseColor" in the graphs once they can discard, so its color cascade applies
		${ ifFeature( 'MATERIAL_GRAPHS' )/* wgsl */`${ evaluateMaterialGraph }( hit, vertexData, view, &surf );` }

		surf.color *= tint.rgb;
		surf.opacity = select( 1.0, surf.opacity * tint.a, material.transparent != 0 );
		surf.matte = material.matte != 0;

		surf.ior = material.ior;
		surf.transmission = transmission;
		surf.thinWall = material.thinWall == 1;
		surf.dispersion = material.dispersion;

		surf.clearcoatNormal = clearcoatNormal;
		surf.clearcoat = clearcoat;

		surf.iridescence = iridescence;
		surf.iridescenceIor = material.iridescenceIor;
		surf.iridescenceThickness = iridescenceThickness;

		surf.specularColor = specularColor;
		surf.specularIntensity = specularIntensity;

		surf.sheen = material.sheen;
		surf.sheenColor = sheenColor;

		let minRoughness = max( MIN_ROUGHNESS, blurRoughness );
		surf.roughness = clamp( surf.roughness, minRoughness, 1.0 );
		surf.clearcoatRoughness = clamp( clearcoatRoughness, minRoughness, 1.0 );
		surf.sheenRoughness = clamp( sheenRoughness, minRoughness, 1.0 );
		surf.anisotropy = anisotropyStrength;

		// frontFace is used to determine transmissive properties and PDF. If no transmission is used
		// then we can just always assume this is a front face.
		surf.frontFace = side == 1.0 || transmission == 0.0;
		if ( material.thinWall == 1 || surf.frontFace ) {

			surf.eta = 1.0 / material.ior;

		} else {

			surf.eta = material.ior;

		}
		surf.f0 = ${ iorToF0Func }( surf.eta );

		// get the normal frames
		surf.normalBasis = surfaceBasis;
		surf.normalInvBasis = ${ inverseMat3x3Func }( surf.normalBasis );

		surf.clearcoatBasis = ${ getBasisFromNormalFunc }( surf.clearcoatNormal );
		surf.clearcoatInvBasis = ${ inverseMat3x3Func }( surf.clearcoatBasis );

		return surf;
	}

`;

/*
 *
 * N 			  : Macronormal of the surface
 * V ( wo ) : View direction
 * L ( wi ) : Light direction
 * H ( wh ) : Halfvector between V and L, micronormal of the surface in ggx
 * f0       : Amount of light reflected when looking at a surface head on - "fresnel 0"
 * f90      : Amount of light reflected at grazing angles
 *
 */

// Disney Diffuse BRDF without subsurface approximation
export const diffuseBrdfFunc = wgslFn( /* wgsl */ `

	fn diffuseBrdf( NdotV: f32, NdotL: f32, VdotH: f32, surf: SurfaceRecord ) -> vec3f {

		// https://blog.selfshadow.com/publications/s2015-shading-course/burley/s2015_pbs_disney_bsdf_notes.pdf
		// See equation (4)

		let fl = schlickFresnel( NdotL, 0.0 );
		let fv = schlickFresnel( NdotV, 0.0 );

		let alpha = surf.roughness * surf.roughness;
		let bias = mix( 0.0, 0.5, alpha ) - 1;
		let energyFactor = mix( 1.0, 1.0 / 1.51, alpha );

		let rr = 2.0 * alpha * VdotH * VdotH;
		let retro = rr * ( fl + fv + fl * fv * ( rr + 2.0 * bias ) );
		let fresnel = ( 1.0 + bias * fl ) * ( 1.0f + bias * fv );

		// TODO: subsurface approx?

		return energyFactor * ( surf.color / PI ) * ( retro + fresnel );

	}

`, [ constants, schlickFresnelFunc, surfaceRecordStruct ] );

// Lambertian diffuse BRDF with cosine distribution
export const lambertBrdfFunc = wgslFn( /* wgsl */ `

	fn lambertBrdf( NdotV: f32, NdotL: f32, VdotH: f32, surf: SurfaceRecord ) -> vec3f {

		return surf.color / PI;

	}

`, [ constants, surfaceRecordStruct ] );

export const specularBrdfFunc = wgslFn( /* wgsl */ `

	fn specularBrdf( V: vec3f, L: vec3f, H: vec3f, alpha: vec2f ) -> vec3f {

		let alphaT = alpha.x;
		let alphaB = alpha.y;

		let Vis = ggxSmithVisibility( V, L, alpha );
		let D = ggxDistribution( H, alpha );

		return vec3f( D * Vis );

	}

`, [ ggxSmithVisibilityFunc, ggxDistributionFunc ] );

// PBRT-v4 treats matched media as perfect specular transmission because the rough dielectric
// half-vector and its Jacobian are undefined when eta is one:
// https://github.com/mmp/pbrt-v4/blob/master/src/pbrt/bxdfs.cpp
export const isMatchedIorFunc = wgslFn( /* wgsl */ `

	fn isMatchedIor( eta: f32 ) -> bool {

		return abs( eta - 1.0 ) < EPSILON;

	}

`, [ constants ] );

export const specularBtdfFunc = wgslFn( /* wgsl */`

	fn specularBtdf( V: vec3f, L: vec3f, H: vec3f, alpha: vec2f, eta: f32 ) -> vec3f {

		let NdotV = V.z;
		let NdotL = L.z;
		let HdotV = dot( V, H );
		let HdotL = dot( L, H );

		// Heaviside function for G term
		if ( NdotV * HdotV < 0.0 || NdotL * HdotL < 0.0 || HdotV * HdotL > 0.0 ) {

			return vec3f( 0.0 );

		}

		let G1_i = ggxShadowMaskG1( V, alpha );
		let G1_o = ggxShadowMaskG1( L, alpha );

		// separable G2 product, no height correlation
		let denom = eta * HdotV + HdotL;
		let Vis = G1_i * G1_o * abs( HdotV ) * abs( HdotL ) /
			( abs( NdotV ) * abs( NdotL ) * denom * denom );

		let F = dielectricFresnel( abs( HdotV ), eta );

		let D = ggxDistribution( H, alpha );

		return vec3f( ( 1 - F ) * D * Vis );

	}

`, [ ggxShadowMaskG1Func, ggxDistributionFunc, dielectricFresnelFunc ] );

// Effective roughness for thin walled transmission, from page 40 (note the slides' 3.7 is a typo for 3.4) -
// referenced from Blender Cycles:
// https://blog.selfshadow.com/publications/s2017-shading-course/imageworks/s2017_pbs_imageworks_slides_v2.pdf
export const thinWallTransmissionRoughnessFunc = wgslFn( /* wgsl */ `

	fn thinWallTransmissionRoughness( alpha: f32, eta: f32 ) -> f32 {

		let t = 3.4 * ( eta - 1.0 ) * ( eta - 0.5 ) * ( eta - 0.5 ) / ( eta * eta * eta );
		return saturate( alpha * sqrt( max( t, 0.0 ) ) );

	}

` );

// Continuous Cauchy IOR approximation derived from the Fraunhofer C, d, and F spectral lines:
// https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_dispersion
// https://github.com/bsdorra/slang-pbr/blob/c12046ec3b9628bcfc384ed2c275c92d007e5d7e/src/models/enterprise/components/transmission.slang#L20-L27
export const DISPERSION_MIN_WAVELENGTH = 380;
export const DISPERSION_MAX_WAVELENGTH = 780;

// Wavelengths in nm are importance sampled in proportion to their luminance under D65 light, so few samples land
// in the dim violet and red ends. The distribution is Cycles' logistic fit over 380 to 780 nm:
// https://projects.blender.org/blender/blender/src/branch/main/intern/cycles/kernel/util/colorspace.h
const WAVELENGTH_FIT = /* wgsl */`
	const WAVELENGTH_FIT_A = 21.71348444564851;
	const WAVELENGTH_FIT_X0 = 0.5554867905834258;
	const WAVELENGTH_FIT_Y0 = 0.021659159132699574;
	const WAVELENGTH_FIT_N = 0.9707633294863183;
`;

export const sampleDispersionWavelengthFunc = wgslFn( /* wgsl */ `

	fn sampleDispersionWavelength( rand: f32 ) -> f32 {

		${ WAVELENGTH_FIT }
		let r = WAVELENGTH_FIT_N * rand + WAVELENGTH_FIT_Y0;
		let micrometers = - log( 1.0 / r - 1.0 ) / WAVELENGTH_FIT_A + WAVELENGTH_FIT_X0;
		return clamp( 1000.0 * micrometers, ${ DISPERSION_MIN_WAVELENGTH }.0, ${ DISPERSION_MAX_WAVELENGTH }.0 );

	}

` );

// The probability density of the sampled wavelength, relative to sampling the range uniformly
const dispersionWavelengthPdfFunc = wgslFn( /* wgsl */ `

	fn dispersionWavelengthPdf( wavelength: f32 ) -> f32 {

		${ WAVELENGTH_FIT }
		let cdf = 1.0 / ( 1.0 + exp( - WAVELENGTH_FIT_A * ( wavelength / 1000.0 - WAVELENGTH_FIT_X0 ) ) );
		let range = ( ${ DISPERSION_MAX_WAVELENGTH }.0 - ${ DISPERSION_MIN_WAVELENGTH }.0 ) / 1000.0;
		return WAVELENGTH_FIT_A * cdf * ( 1.0 - cdf ) * range / WAVELENGTH_FIT_N;

	}

` );

export const dispersionIorFunc = wgslFn( /* wgsl */ `

	fn dispersionIor( ior: f32, dispersion: f32, wavelength: f32 ) -> f32 {

		let nd = max( ior, 1.0 );
		let scale = ( nd - 1.0 ) * max( dispersion, 0.0 ) / 20.0;
		let lambda = clamp( wavelength, ${ DISPERSION_MIN_WAVELENGTH }.0, ${ DISPERSION_MAX_WAVELENGTH }.0 );
		return max( nd + scale * ( 523655.0 / ( lambda * lambda ) - 1.5168 ), 1.0 );

	}

` );

// The opacity of a hit from the material's side, the material and object opacity, the vertex colors and the alpha of
// the map and alpha map, for a shading model's "getHitOpacity". Reads the materials, texture sampling and vertex data
// through the node context so any shading model whose material struct has these fields can use it
const materialsStorage = /* @__PURE__ */ contextProxy( 'shadingModel.storage.materials' );
const sampleTrianglePoint = /* @__PURE__ */ contextProxyFn( 'bvhData.fns.sampleTrianglePoint' );
const sampleTexel = /* @__PURE__ */ contextProxyFn( 'shadingModel.fns.sampleTexel' );
const getUvFromChannel = /* @__PURE__ */ contextProxyFn( 'bvhData.fns.getUvFromChannel' );
const getColor = /* @__PURE__ */ contextProxyFn( 'bvhData.fns.getColor' );
export const getHitOpacityFunc = wgslTagFn/* wgsl */ `

	fn getHitOpacity( materialIndex: u32, objectAlpha: f32, indices: vec3u, attributesOffset: u32, barycoord: vec3f, side: f32 ) -> f32 {

		let material = &${ materialsStorage }[ materialIndex ];
		if ( side != 0.0 && material.side != 0.0 && side != material.side ) {

			return 0.0;

		}

		if ( material.transparent == 0 && material.alphaTest <= 0.0 ) {

			return 1.0;

		}

		let vertex = ${ sampleTrianglePoint }( barycoord, indices, attributesOffset );
		var opacity = material.opacity * objectAlpha;
		if ( material.vertexColors == 1 ) {

			opacity *= ${ getColor }( vertex ).a;

		}

		if ( material.map != - 1 ) {

			let uv = ${ getUvFromChannel }( vertex, material.map );
			// TODO: the transform is read by index to work around a WebKit bug, which fails to compile a
			// matrix read through a storage pointer times a vector. Use "material" once it's fixed.
			let uvPrime = ${ materialsStorage }[ materialIndex ].mapTransform * vec3f( uv, 1 );
			opacity *= ${ sampleTexel }( uvPrime.xy, material.map, 0 ).a;

		}

		if ( material.alphaMap != - 1 ) {

			let uv = ${ getUvFromChannel }( vertex, material.alphaMap );
			let uvPrime = ${ materialsStorage }[ materialIndex ].alphaMapTransform * vec3f( uv, 1 );
			opacity *= ${ sampleTexel }( uvPrime.xy, material.alphaMap, 0 ).g;

		}

		// alpha tested surfaces below the cutoff and fully transparent ones are passed, and opaque alpha tested
		// surfaces are fully opaque
		if ( opacity < material.alphaTest || opacity <= 0.0 ) {

			return 0.0;

		}

		return select( 1.0, opacity, material.transparent != 0 );

	}

`;

// The light emitted by a point on one side of a triangle, for a shading model's "getHitEmission". Sides the material doesn't
// render don't emit
export const getHitEmissionFunc = wgslTagFn/* wgsl */ `

	fn getHitEmission( materialIndex: u32, indices: vec3u, attributesOffset: u32, barycoord: vec3f, side: f32 ) -> vec3f {

		let material = &${ materialsStorage }[ materialIndex ];
		if ( material.side != 0.0 && side != material.side ) {

			return vec3f( 0.0 );

		}

		var emission = material.emissiveIntensity * material.emissive;
		if ( material.emissiveMap != - 1 ) {

			let vertex = ${ sampleTrianglePoint }( barycoord, indices, attributesOffset );
			let uv = ${ getUvFromChannel }( vertex, material.emissiveMap );
			let uvPrime = ${ materialsStorage }[ materialIndex ].emissiveMapTransform * vec3f( uv, 1.0 );
			emission *= ${ sampleTexel }( uvPrime.xy, material.emissiveMap, 0.0 ).rgb;

		}

		return emission;

	}

`;

// Refracts a dispersive surface at the wavelength, returning whether the surface is dispersive: transmissive with a
// volume, an ior above one and some dispersion. Takes the surface by name since the shading model defines its struct
export const applyDispersionFunc = wgslTagFn/* wgsl */ `

	fn applyDispersion( surf: ptr<function, SurfaceRecord>, wavelength: f32 ) -> bool {

		if ( surf.dispersion <= 0.0 || surf.ior <= 1.0 || surf.transmission <= 0.0 || surf.thinWall ) {

			return false;

		}

		surf.ior = ${ dispersionIorFunc }( surf.ior, surf.dispersion, wavelength );
		surf.eta = select( surf.ior, 1.0 / surf.ior, surf.thinWall || surf.frontFace );
		surf.f0 = ${ iorToF0Func }( surf.eta );
		return true;

	}

`;

// Wyman, Sloan and Shirley's multi-lobe fit of the CIE 1931 color matching functions, each lobe
// [ amplitude, center in nm, inverse width below the center, inverse width above it ]:
// https://jcgt.org/published/0002/02/01/
const CIE_X_LOBES = [[ 0.362, 442.0, 0.0624, 0.0374 ], [ 1.056, 599.8, 0.0264, 0.0323 ], [ - 0.065, 501.1, 0.0490, 0.0382 ]];
const CIE_Y_LOBES = [[ 0.821, 568.8, 0.0213, 0.0247 ], [ 0.286, 530.9, 0.0613, 0.0322 ]];
const CIE_Z_LOBES = [[ 1.217, 437.0, 0.0845, 0.0278 ], [ 0.681, 459.0, 0.0385, 0.0725 ]];

const XYZ_TO_LINEAR_REC709 = mat3( ColorManagement.spaces[ LinearSRGBColorSpace ].fromXYZ );

// 1 / the average of each linear Rec. 709 channel of the fit over the sampled wavelengths, so each channel's weight
// averages to one
const DISPERSION_RGB_NORMALIZATION = [ 2.2719377, 3.4647771, 3.6605261 ];

const cieLobeFunc = wgslFn( /* wgsl */ `

	fn cieLobe( lambda: f32, center: f32, widthBelow: f32, widthAbove: f32 ) -> f32 {

		let t = ( lambda - center ) * select( widthAbove, widthBelow, lambda < center );
		return exp( - 0.5 * t * t );

	}

` );

// the sum of a color matching function's lobes at "lambda"
const sumCieLobes = lobes => lobes
	.map( ( [ amplitude, center, widthBelow, widthAbove ] ) => `${ amplitude } * cieLobe( lambda, ${ center }, ${ widthBelow }, ${ widthAbove } )` )
	.join( ' + ' );

// A path keeps one sampled hero wavelength after its first dispersive interaction.
// The CIE 1931 fit is converted to linear Rec. 709, clamped to the RGB gamut, and normalized so
// every channel has an expected weight of one over the wavelength range, then divided by the sampling pdf.
// This preserves the expected value of the renderer's existing RGB throughput while providing
// continuous hues. The renderer still uses RGB material and light data rather than spectral data.
// Hero wavelength sampling:
// https://pbr-book.org/4ed/Textures_and_Materials/Material_Interface_and_Implementations.html#sec:dielectric-material
// https://doi.org/10.1111/cgf.12419
export const dispersionColorWeightFunc = wgslTagFn/* wgsl */ `

	${ [ cieLobeFunc ] }
	fn dispersionColorWeight( wavelength: f32 ) -> vec3f {

		let lambda = clamp( wavelength, ${ DISPERSION_MIN_WAVELENGTH }.0, ${ DISPERSION_MAX_WAVELENGTH }.0 );
		let xyz = vec3f(
			${ sumCieLobes( CIE_X_LOBES ) },
			${ sumCieLobes( CIE_Y_LOBES ) },
			${ sumCieLobes( CIE_Z_LOBES ) },
		);

		let linearRgb = max( ${ XYZ_TO_LINEAR_REC709 } * xyz, vec3f( 0.0 ) );
		return linearRgb * vec3f( ${ DISPERSION_RGB_NORMALIZATION.join( ', ' ) } ) / ${ dispersionWavelengthPdfFunc }( lambda );

	}

`;

// Dielectric layer fresnel operator that supports custom f0 color, specular weight.
// Based on the specular color specification:
// https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_specular
export const fresnelMixFunc = wgslFn( /* wgsl */ `

	fn fresnelMix( VdotH: f32, f0Color: vec3f, ior: f32, eta: f32, weight: f32, base: vec3f, layer: vec3f ) -> vec3f {

		var f0 = iorToF0( ior ) * f0Color;
		f0 = min( f0, vec3f( 1.0 ) );

		// reflect all light on total internal reflection, matching the WebGL evaluateFresnel function
		var fr = vec3f( 1.0 );
		if ( ! totalInternalReflection( abs( VdotH ), eta ) ) {

			fr = schlickFresnelVec( abs( VdotH ), f0, vec3f( 1.0 ) );

		}

		let maxFr = max( max( fr.r, fr.g ), fr.b );

		return ( 1.0 - weight * maxFr ) * base + weight * fr * layer;

	}

`, [ schlickFresnelVecFunc, iorToF0Func, totalInternalReflectionFunc ] );

const evalSensitivityFunc = wgslTagFn/* wgsl */`

	fn evalSensitivity( OPD: f32, shift: vec3f ) -> vec3f {

		let phase = 2.0 * ${ Math.PI } * OPD * 1.0e-9;
		const val = vec3(5.4856e-13, 4.4201e-13, 5.2481e-13);
		const pos = vec3(1.6810e+06, 1.7953e+06, 2.2084e+06);
		const _var = vec3(4.3278e+09, 9.3046e+09, 6.6121e+09);

		var xyz = val * sqrt(2.0 * ${ Math.PI } * _var) * cos(pos * phase + shift) * exp(-phase * phase * _var);
		xyz.x += 9.7470e-14 * sqrt(2.0 * ${ Math.PI } * 4.5282e+09) * cos(2.2399e+06 * phase + shift.x) * exp(-4.5282e+09 * phase * phase);
		xyz /= 1.0685e-7;

		let rgb = ${ XYZ_TO_LINEAR_REC709 } * xyz;
		return rgb;

	}

`;

// Reference: Belcour/Barla, 2017
// https://belcour.github.io/blog/research/publication/2017/05/01/brdf-thin-film.html
// This is a simplified model that ignores light polarization and uses fresnel approximation
export const iridescentFresnelFunc = wgslFn( /* wgsl */ `

	fn iridescentFresnel(
		cosTheta1: f32, baseF0: vec3f, iridescenceIor: f32,
		outsideIor: f32, iridescenceThickness: f32,
	) -> vec3f {

		let sinTheta2Sq = pow( outsideIor / iridescenceIor, 2.0 ) * ( 1.0 - pow( cosTheta1, 2.0 ) );
		let cosTheta2Sq = 1.0 - sinTheta2Sq;

		// Handle total internal reflection
		if ( cosTheta2Sq < 0.0 ) {

			return vec3( 1.0 );

		}

		let cosTheta2 = sqrt( cosTheta2Sq );

		// First interface: air -> iridescent thin film
		let R0 = iorToF0General( iridescenceIor, outsideIor );
		let R12 = schlickFresnel( cosTheta1, R0 );
		let R21 = R12;
		let T121 = 1.0 - R12;
		let phi12 = select( 0.0, PI, iridescenceIor < outsideIor );
		let phi21 = PI - phi12;

		// Second interface: iridescent thin film -> base material
		let baseIor = fresnel0ToIor( clamp( baseF0, vec3( 0.0 ), vec3( 0.9999 ) ) ); // guard against 1.0
		let R1 = iorToF0GeneralVec( baseIor, vec3( iridescenceIor ) );
		var R23 = schlickFresnelVec( cosTheta2, R1, vec3( 1.0 ) );

		// Handle total internal reflection at the film -> base interface
		// NOTE: Added separately from the original implementation. Is this correct?
		R23 = select( R23, vec3( 1.0 ), totalInternalReflectionVec( cosTheta2, vec3( iridescenceIor ) / baseIor ) );
		let phi23 = select( vec3( 0.0 ), vec3( PI ), baseIor < vec3( iridescenceIor ) );

		// Phase shift
		let OPD = 2.0 * iridescenceIor * iridescenceThickness * cosTheta2;
		let phi = vec3( phi21 ) + phi23;

		// Analytical integration
		// Compound terms
		let R123 = clamp( R12 * R23, vec3( 1e-5 ), vec3( 0.9999 ) );
		let r123 = sqrt( R123 );
		let Rs = T121 * T121 * R23 / ( vec3( 1.0 ) - R123 );

		// Reflectance term for m = 0 (DC term amplitude)
		let C0 = R12 + Rs;
		var I = C0;

		// Reflectance term for m > 0 (pairs of diracs)
		var Cm = Rs - T121;
		for (var m = 1; m <= 2; m += 1) {

			Cm *= r123;
			let Sm = 2.0 * evalSensitivity( f32( m ) * OPD, f32( m ) * phi );
			I += Cm * Sm;

		}

		return max( I, vec3(0.0) );

	}

`, [ iorToF0GeneralFunc, iorToF0GeneralVecFunc, schlickFresnelFunc, fresnel0ToIorFunc, evalSensitivityFunc, totalInternalReflectionVecFunc ] );

// Reflection and transmission coefficients for the transmissive dielectric layer. The scalar
// branch probability follows Cycles: choose between the two colored coefficients by their mean
// energy while retaining the full RGB coefficient in the path throughput.
export const transmissionFresnelFunc = ( iridescentFresnel = iridescentFresnelFunc ) => wgslTagFn/* wgsl */ `

	fn transmissionFresnel( cosTheta: f32, surf: ${ surfaceRecordStruct } ) -> ${ transmissionFresnelStruct } {

		var result: ${ transmissionFresnelStruct };
		let cosine = saturate( abs( cosTheta ) );
		let matchedIor = ${ isMatchedIorFunc }( surf.eta );
		let airIncident = surf.thinWall || surf.frontFace;
		let dielectricFresnel = ${ dielectricFresnelFunc }( cosine, surf.eta );

		// Keep matched media transparent unless a real thin-film layer is present. This avoids
		// introducing the non-physical Schlick F90 reflection produced by KHR_materials_specular
		// when the substrate itself has no IOR boundary.
		var reflectance = vec3f( 0.0 );
		if ( ! matchedIor ) {

			let specularF0 = min( surf.f0 * surf.specularColor, vec3f( 1.0 ) );
			let dielectricReflectance = select(
				vec3f( dielectricFresnel ),
				${ schlickFresnelVecFunc }( cosine, specularF0, vec3f( 1.0 ) ),
				airIncident,
			);
			reflectance = surf.specularIntensity * dielectricReflectance;

		}

		reflectance = clamp( reflectance, vec3f( 0.0 ), vec3f( 1.0 ) );
		var transmittance = vec3f( 1.0 ) - reflectance;

		if ( surf.iridescence > 0.0 ) {

			// The media on either side of the film are air outside and the volume interior as
			// the base. Swap them on interior hits so film-interface TIR remains possible.
			let outsideIor = select( surf.ior, 1.0, airIncident );
			let filmBaseIor = select( 1.0, surf.ior, airIncident );
			let filmReflectance = clamp( ${ iridescentFresnel }(
				cosine,
				vec3f( ${ iorToF0Func }( filmBaseIor ) ),
				surf.iridescenceIor,
				outsideIor,
				surf.iridescenceThickness,
			), vec3f( 0.0 ), vec3f( 1.0 ) );

			reflectance = mix( reflectance, filmReflectance, surf.iridescence );
			transmittance = mix( transmittance, vec3f( 1.0 ) - filmReflectance, surf.iridescence );

		}

		result.reflectance = reflectance;
		result.transmittance = transmittance;

		// Include the base-color tint in the transmission energy, as Cycles does when it
		// computes the glass reflection probability from its two tinted coefficients.
		let reflectEnergy = dot( reflectance, vec3f( 1.0 / 3.0 ) );
		let transmissionTint = select( sqrt( surf.color ), surf.color, surf.thinWall );
		let transmitEnergy = dot( transmittance * transmissionTint, vec3f( 1.0 / 3.0 ) );
		let totalEnergy = reflectEnergy + transmitEnergy;
		result.reflectProbability = select( 0.0, reflectEnergy / max( totalEnergy, EPSILON ), totalEnergy > EPSILON );

		return result;

	}

`;

export const conductorFresnelFunc = wgslFn( /* wgsl */ `

	fn conductorFresnel( VdotH: f32, f0: vec3f, specular: vec3f ) -> vec3f {

		return specular * schlickFresnelVec( abs( VdotH ), f0, vec3f( 1 ) );

	}

`, [ schlickFresnelVecFunc ] );

export const fresnelCoatFunc = wgslFn( /* wgsl */ `

	fn fresnelCoat( VdotNc: f32, ior: f32, base: vec3f, layer: vec3f, weight: f32 ) -> vec3f {

		let f0 = iorToF0( ior );
		let F = schlickFresnel( abs( VdotNc ), f0 );

		return mix( base, layer, weight * F );

	}

`, [ iorToF0Func, schlickFresnelFunc ] );

// GGX Multibounce compensation using Turquin's method. Bakes the directional albedo of the
// reflection lobe, optionally fresnel-weighted, and optionally including the refraction lobe
// for the full transmissive bsdf. "eta" is the incident over transmitted ior ratio.
export const turquinIntegralFn = outputTarget => wgslTagFn/* wgsl */ `

	fn albedo(
		eta: f32,
		includeFresnel: bool,
		includeRefraction: bool,
		globalId: vec3u,
		layer: u32,
	) -> void {

		// The matched-IOR limit is a unit-energy delta transmission event, so it cannot
		// be integrated with the rough BTDF below.
		if ( includeRefraction && ${ isMatchedIorFunc }( eta ) ) {

			textureStore( ${ outputTarget }, vec3( globalId.xy, layer ), vec4( 1.0 ) );
			return;

		}

		// sample the brdf directions in a grid pattern
		const GRID_SIZE = 64u;

		// TODO: this sampling means that energy at 0.0 & 1.0 roughness (and 0 and 90deg cos) are never
		// written to the texture due to the half texel inset, resulting in small, though possibly noticeable,
		// error in common cases.
		let dimensions = textureDimensions( ${ outputTarget } ).xy;
		let uv = ( vec2f( globalId.xy ) + vec2f( 0.5 ) ) / vec2f( dimensions );

		let cosThetaO = uv.x;
		let roughness = uv.y;
		let alpha = roughness * roughness;

		let wo = vec3( sqrt( 1 - cosThetaO * cosThetaO ), 0 , cosThetaO );

		let f0 = ${ iorToF0Func }( eta );

		var result = 0.0;
		for ( var x = 0u; x < GRID_SIZE; x++ ) {

			for ( var y = 0u; y < GRID_SIZE; y++ ) {

				// calculate the half vector to sample
				let gridPoint = vec2f( vec2u( x, y ) ) + vec2f( 0.5 );
				let sampleUv = gridPoint / f32( GRID_SIZE );
				let wh = ${ ggxDirectionFunc }( wo, vec2( alpha ), sampleUv );

				var f = 1.0;
				if ( includeFresnel ) {

					// use the exact dielectric fresnel so the table agrees with the fresnel used
					// for lobe sampling
					f = ${ dielectricFresnelFunc }( dot( wo, wh ), eta );

				}

				// air-incident reflection is evaluated with schlick in bsdfEval - only the
				// volume-incident ( TIR ) glass reflection uses the exact fresnel
				var reflectionF = f;
				if ( eta < 1.0 ) {

					reflectionF = ${ schlickFresnelFunc }( dot( wo, wh ), f0 );

				}

				// reflection lobe - samples landing below the surface are lost
				let wi = - reflect( wo, wh );
				let reflectionPdf = ${ ggxReflectionAdjustedPDFFunc }( wo, wh, vec2f( alpha ) );
				if ( wi.z > 0.0 && reflectionPdf != 0.0 ) {

					let specular = ${ specularBrdfFunc }( wo, wi, wh, vec2f( alpha ) );
					result += reflectionF * specular.x * wi.z / reflectionPdf;

				}

				// refraction lobe - the btdf carries its own ( 1 - F ) fresnel weight, and
				// samples landing back above the surface are lost
				if ( includeRefraction ) {

					let wiRefract = refract( - wo, wh, eta );
					if ( wiRefract.z < 0.0 ) {

						let transmission = ${ specularBtdfFunc }( wo, wiRefract, wh, vec2f( alpha ), eta );
						let pdf = ${ ggxRefractionAdjustedPDFFunc }( wo, wiRefract, wh, vec2f( alpha ), eta );
						if ( pdf != 0.0 ) {

							result += transmission.x * abs( wiRefract.z ) / pdf;

						}

					}

				}

			}

		}

		result /= f32( GRID_SIZE * GRID_SIZE );

		textureStore( ${ outputTarget }, vec3( globalId.xy, layer ), vec4( result ) );

	}

`;
