export const attenuateHitGLSL = /* glsl */`

	// step through multiple surface hits and accumulate color attenuation based on transmissive surfaces
	// returns true if a solid surface was hit
	bool attenuateHit(
		BVH bvh, vec3 rayOrigin, vec3 rayDirection, float rayDist,
		int traversals, int transmissiveTraversals, bool isShadowRay,
		Material fogMaterial,
		out vec3 color
	) {

		vec3 ogRayOrigin = rayOrigin;

		// hit results
		uvec4 faceIndices = uvec4( 0u );
		vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
		vec3 barycoord = vec3( 0.0 );
		float side = 1.0;
		float dist = 0.0;
		LightSampleRecord lightSampleRec;

		color = vec3( 1.0 );

		// TODO: we should be using sobol sampling here instead of rand but the sobol bounce and path indices need to be incremented
		// and then reset.
		for ( int i = 0; i < traversals; i ++ ) {

			int hitType = traceScene(
				rayOrigin, rayDirection,
				bvh, lights, fogMaterial,
				faceIndices, faceNormal, barycoord, side, dist,
				lightSampleRec
			);

			if ( hitType == FOG_HIT ) {

				return true;

			} else if ( hitType == LIGHT_HIT ) {

				float totalDist = distance( ogRayOrigin, rayOrigin + rayDirection * lightSampleRec.dist );
				return totalDist < rayDist - max( totalDist, rayDist ) * 1e-4;

			} else if ( hitType == SURFACE_HIT ) {

				float totalDist = distance( ogRayOrigin, rayOrigin + rayDirection * dist );
				if ( totalDist > rayDist ) {

					return false;

				}

				// TODO: attenuate the contribution based on the PDF of the resulting ray including refraction values
				// Should be able to work using the material BSDF functions which will take into account specularity, etc.
				// TODO: should we account for emissive surfaces here?

				uint materialIndex = uTexelFetch1D( materialIndexAttribute, faceIndices.x ).r;
				Material material = readMaterialInfo( materials, materialIndex );

				// adjust the ray to the new surface
				bool isEntering = side == 1.0;
				rayOrigin = stepRayOrigin( rayOrigin, rayDirection, - faceNormal, dist );

				#if FEATURE_FOG

				if ( material.fogVolume ) {

					fogMaterial = material;
					fogMaterial.fogVolume = side == 1.0;
					i -= sign( transmissiveTraversals );
					transmissiveTraversals --;
					continue;

				}

				#endif

				if ( ! material.castShadow && isShadowRay ) {

					continue;

				}

				vec2 uv = textureSampleBarycoord( attributesArray, ATTR_UV, barycoord, faceIndices.xyz ).xy;
				vec4 vertexColor = textureSampleBarycoord( attributesArray, ATTR_COLOR, barycoord, faceIndices.xyz );

				// albedo
				vec4 albedo = vec4( material.color, material.opacity );
				if ( material.map != - 1 ) {

					vec3 uvPrime = material.mapTransform * vec3( uv, 1 );
					albedo *= texture2D( textures, vec3( uvPrime.xy, material.map ) );

				}

				if ( material.vertexColors ) {

					albedo *= vertexColor;

				}

				// alphaMap
				if ( material.alphaMap != - 1 ) {

					albedo.a *= texture2D( textures, vec3( uv, material.alphaMap ) ).x;

				}

				// transmission
				float transmission = material.transmission;
				if ( material.transmissionMap != - 1 ) {

					vec3 uvPrime = material.transmissionMapTransform * vec3( uv, 1 );
					transmission *= texture2D( textures, vec3( uvPrime.xy, material.transmissionMap ) ).r;

				}

				// metalness
				float metalness = material.metalness;
				if ( material.metalnessMap != - 1 ) {

					vec3 uvPrime = material.metalnessMapTransform * vec3( uv, 1 );
					metalness *= texture2D( textures, vec3( uvPrime.xy, material.metalnessMap ) ).b;

				}

				float alphaTest = material.alphaTest;
				bool useAlphaTest = alphaTest != 0.0;
				float transmissionFactor = ( 1.0 - metalness ) * transmission;
				if (
					transmissionFactor < rand() && ! (
						// material sidedness
						material.side != 0.0 && side == material.side

						// alpha test
						|| useAlphaTest && albedo.a < alphaTest

						// opacity
						|| material.transparent && ! useAlphaTest && albedo.a < rand()
					)
				) {

					return true;

				}

				if ( side == 1.0 && isEntering ) {

					// only attenuate by surface color on the way in
					color *= mix( vec3( 1.0 ), albedo.rgb, transmissionFactor );

				} else if ( side == - 1.0 ) {

					// attenuate by medium once we hit the opposite side of the model
					color *= transmissionAttenuation( dist, material.attenuationColor, material.attenuationDistance );

				}

				bool isTransmissiveRay = dot( rayDirection, faceNormal * side ) < 0.0;
				if ( ( isTransmissiveRay || isEntering ) && transmissiveTraversals > 0 ) {

					i -= sign( transmissiveTraversals );
					transmissiveTraversals --;

				}

			} else {

				return false;

			}

		}

		return true;

	}

`;
