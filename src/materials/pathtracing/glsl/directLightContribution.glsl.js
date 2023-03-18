export const directLightContributionGLSL = /*glsl*/`

	vec3 directLightContribution( vec3 outgoing, vec3 clearcoatOutgoing, SurfaceRecord surf, RenderState state, Ray ray ) {

		// uniformly pick a light or environment map
		if( lightsDenom != 0.0 && sobol( 5 ) < float( lights.count ) / lightsDenom ) {

			// sample a light or environment
			LightSampleRecord lightSampleRec = randomLightSample( lights.tex, iesProfiles, lights.count, ray.origin, sobol3( 6 ) );

			bool isSampleBelowSurface = ! surf.volumeParticle && dot( surf.faceNormal, lightSampleRec.direction ) < 0.0;
			if ( isSampleBelowSurface ) {

				lightSampleRec.pdf = 0.0;

			}

			// check if a ray could even reach the light area
			Ray lightRay = ray;
			ray.direction = lightSampleRec.direction;
			vec3 attenuatedColor;
			if (
				lightSampleRec.pdf > 0.0 &&
				isDirectionValid( lightSampleRec.direction, surf.normal, surf.faceNormal ) &&
				! attenuateHit( bvh, state, ray, lightSampleRec.dist, attenuatedColor )
			) {

				// get the material pdf
				vec3 sampleColor;
				float lightMaterialPdf = bsdfResult( outgoing, clearcoatOutgoing, normalize( surf.normalInvBasis * lightSampleRec.direction ), normalize( surf.clearcoatInvBasis * lightSampleRec.direction ), surf, sampleColor );
				bool isValidSampleColor = all( greaterThanEqual( sampleColor, vec3( 0.0 ) ) );
				if ( lightMaterialPdf > 0.0 && isValidSampleColor ) {

					// weight the direct light contribution
					float lightPdf = lightSampleRec.pdf / lightsDenom;
					float misWeight = lightSampleRec.type == SPOT_LIGHT_TYPE || lightSampleRec.type == DIR_LIGHT_TYPE || lightSampleRec.type == POINT_LIGHT_TYPE ? 1.0 : misHeuristic( lightPdf, lightMaterialPdf );
					return attenuatedColor * lightSampleRec.emission * state.throughputColor * sampleColor * misWeight / lightPdf;

				}

			}

		} else {

			// find a sample in the environment map to include in the contribution
			vec3 envColor, envDirection;
			float envPdf = sampleEquirectProbability( envMapInfo, sobol2( 7 ), envColor, envDirection );
			envDirection = invEnvRotation3x3 * envDirection;

			// this env sampling is not set up for transmissive sampling and yields overly bright
			// results so we ignore the sample in this case.
			// TODO: this should be improved but how? The env samples could traverse a few layers?
			bool isSampleBelowSurface = ! surf.volumeParticle && dot( surf.faceNormal, envDirection ) < 0.0;
			if ( isSampleBelowSurface ) {

				envPdf = 0.0;

			}

			// check if a ray could even reach the surface
			Ray envRay = ray;
			envRay.direction = envDirection;
			vec3 attenuatedColor;
			if (
				envPdf > 0.0 &&
				isDirectionValid( envDirection, surf.normal, surf.faceNormal ) &&
				! attenuateHit( bvh, state, ray, INFINITY, attenuatedColor )
			) {

				// get the material pdf
				vec3 sampleColor;
				float envMaterialPdf = bsdfResult( outgoing, clearcoatOutgoing, normalize( surf.normalInvBasis * envDirection ), normalize( surf.clearcoatInvBasis * envDirection ), surf, sampleColor );
				bool isValidSampleColor = all( greaterThanEqual( sampleColor, vec3( 0.0 ) ) );
				if ( envMaterialPdf > 0.0 && isValidSampleColor ) {

					// weight the direct light contribution
					envPdf /= lightsDenom;
					float misWeight = misHeuristic( envPdf, envMaterialPdf );
					return attenuatedColor * environmentIntensity * envColor * state.throughputColor * sampleColor * misWeight / envPdf;

				}

			}

		}

		return vec3( 0.0 );

	}

`;
