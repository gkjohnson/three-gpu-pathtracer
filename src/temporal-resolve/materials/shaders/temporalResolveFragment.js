export const fragmentShader = /* glsl */`
uniform sampler2D samplesTexture;
uniform sampler2D accumulatedSamplesTexture;
uniform sampler2D velocityTexture;
uniform sampler2D depthTexture;
uniform sampler2D lastDepthTexture;

uniform float samples;

uniform float temporalResolveMix;
uniform float clampRadius;
uniform float newSamplesSmoothing;
uniform float newSamplesCorrection;
uniform float tileCount;

uniform mat4 curInverseProjectionMatrix;
uniform mat4 curCameraMatrixWorld;

uniform mat4 prevInverseProjectionMatrix;
uniform mat4 prevCameraMatrixWorld;

uniform float cameraNear;
uniform float cameraFar;

varying vec2 vUv;

#include <packing>

#define FLOAT_EPSILON 0.00001
#define BLUR_EXPONENT 0.5
#define MAX_NEIGHBOR_DEPTH_DIFFERENCE 0.001

// credits for transforming screen position to world position: https://discourse.threejs.org/t/reconstruct-world-position-in-screen-space-from-depth-buffer/5532/2
vec3 screenSpaceToWorldSpace( const vec2 uv, const float depth, mat4 inverseProjectionMatrix, mat4 cameraMatrixWorld ) {
    vec4 ndc = vec4(
        ( uv.x - 0.5 ) * 2.0,
        ( uv.y - 0.5 ) * 2.0,
        ( depth - 0.5 ) * 2.0,
        1.0
	);

    vec4 clip = inverseProjectionMatrix * ndc;
    vec4 view = cameraMatrixWorld * ( clip / clip.w );

    return view.xyz;
}

#ifdef DILATION
// source: https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/ (modified to GLSL)
vec4 getDilatedTexture( sampler2D tex, vec2 uv, vec2 texSize ) {

    float closestDepth = 0.0;
    vec2 closestUVOffset;

    for ( int x = - 1; x <= 1; ++ x ) {

        for ( int y = - 1; y <= 1; ++ y ) {

            vec2 uvOffset = vec2( x, y ) / texSize;
            float neighborDepth = textureLod( tex, vUv + uvOffset, 0.0 ).b;
            if ( neighborDepth > closestDepth ) {

                closestUVOffset = uvOffset;
                closestDepth = neighborDepth;

            }

        }

    }

    return textureLod( tex, vUv + closestUVOffset, 0.0 );

}
#endif

// idea from: https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/
vec3 transformColor( vec3 color ) {

    return pow( color, vec3( WEIGHT_TRANSFORM ) );

}

vec3 undoColorTransform( vec3 color ) {

	return max( vec3( 0.0 ), pow( color, vec3( 1.0 / WEIGHT_TRANSFORM ) ) );

}

void main() {

	vec4 samplesTexel = texture2D( samplesTexture, vUv );
	samplesTexel.rgb = transformColor( samplesTexel.rgb );

	ivec2 size = textureSize( samplesTexture, 0 );
	vec2 pxSize = vec2( size.x, size.y );

#ifdef DILATION
    vec4 velocity = getDilatedTexture( velocityTexture, vUv, pxSize );

	vec2 velUv = velocity.xy;
    vec2 reprojectedUv = vUv - velUv;
#else
    vec4 velocity = textureLod( velocityTexture, vUv, 0.0 );

	vec2 velUv = velocity.xy;
    vec2 reprojectedUv = vUv - velUv;
#endif

	bool isTileRendered = samplesTexel.a != 0.0;

	// background doesn't need reprojection
	if( velocity.a == 1.0 ) {

		samplesTexel.rgb = undoColorTransform( samplesTexel.rgb );
		gl_FragColor = vec4( samplesTexel.rgb, isTileRendered ? 1.0 : 0.0 );
		
		return;

	}

	// depth textures should not be dilated
	float unpackedDepth = unpackRGBAToDepth( textureLod( depthTexture, vUv, 0.0 ) );
	float lastUnpackedDepth = unpackRGBAToDepth( textureLod( lastDepthTexture, reprojectedUv, 0.0 ) );

    float movement = length( velUv ) * 100.0;

	vec3 curWorldPos = screenSpaceToWorldSpace( vUv, unpackedDepth, curInverseProjectionMatrix, curCameraMatrixWorld );
	vec3 lastWorldPos = screenSpaceToWorldSpace( vUv, lastUnpackedDepth, prevInverseProjectionMatrix, prevCameraMatrixWorld );
	float distToLastFrame = length( curWorldPos - lastWorldPos ) * 0.25;

	vec4 accumulatedSamplesTexel;
    vec3 outputColor;
	float alpha;

	bool canReproject = reprojectedUv.x >= 0.0 && reprojectedUv.x <= 1.0 && reprojectedUv.y >= 0.0 && reprojectedUv.y <= 1.0;

	// check that the reprojected UV is valid
	if ( canReproject ) {

		accumulatedSamplesTexel = textureLod( accumulatedSamplesTexture, reprojectedUv, 0.0 );
		accumulatedSamplesTexel.rgb = transformColor( accumulatedSamplesTexel.rgb );

        alpha = distToLastFrame < 0.25 ? ( accumulatedSamplesTexel.a + 0.05 ) : 0.0;

		// alpha = 0.0 is reserved for the background (to find out if the tile hasn't been rendered yet)
		alpha = clamp( alpha, FLOAT_EPSILON, 1.0 );

		if( samplesTexel.a != 0.0 ) {

			vec2 px = 1.0 / pxSize;

			vec3 boxBlurredColor;
			float totalWeight;

			vec3 minNeighborColor = vec3( 1.0, 1.0, 1.0 );
			vec3 maxNeighborColor = vec3( 0.0, 0.0, 0.0 );

			// use a small ring if there is a lot of movement otherwise there will be more smearing
			float radius = movement > 1.0 ? 1.0 : clampRadius;

			vec3 col;
			float weight;
			vec2 neighborUv;
			bool neighborUvValid;
			float neighborUnpackedDepth;

			for( float x = - radius; x <= radius; x ++ ) {

				for( float y = - radius; y <= radius; y ++ ) {

					neighborUv = vUv + px * vec2( x, y );
					neighborUvValid = neighborUv.x >= 0.0 && neighborUv.x <= 1.0 && neighborUv.y >= 0.0 && neighborUv.y <= 1.0;

					if( neighborUvValid ) {

						col = textureLod( samplesTexture, neighborUv, 0.0 ).rgb;
						col = transformColor( col );

						neighborUnpackedDepth = unpackRGBAToDepth( textureLod( lastDepthTexture, neighborUv, 0.0 ) );

						// box blur
						if( abs( x ) <= 3.0 && abs( y ) <= 3.0 && abs( unpackedDepth - neighborUnpackedDepth ) < MAX_NEIGHBOR_DEPTH_DIFFERENCE ) {

							weight = 1.0 - abs( dot( col - samplesTexel.rgb, vec3( 0.25 ) ) );
							weight = pow( weight, BLUR_EXPONENT );
							boxBlurredColor += col * weight;
							totalWeight += weight;

						}

						minNeighborColor = min( col, minNeighborColor );
						maxNeighborColor = max( col, maxNeighborColor );

					}

				}

			}

			// clamp the reprojected frame (neighborhood clamping)
			accumulatedSamplesTexel.rgb = mix( accumulatedSamplesTexel.rgb, clamp( accumulatedSamplesTexel.rgb, minNeighborColor, maxNeighborColor ), newSamplesCorrection );

			// let's blur the input color to reduce noise for new samples
			if ( newSamplesSmoothing != 0.0 && alpha < 1.0 && totalWeight > FLOAT_EPSILON ) {

				boxBlurredColor /= totalWeight;
				samplesTexel.rgb = mix( samplesTexel.rgb, boxBlurredColor, newSamplesSmoothing );

			}

		}

	} else {

		// reprojected UV coordinates are outside of screen, so just use the current frame for it
		alpha = FLOAT_EPSILON;
		accumulatedSamplesTexel.rgb = samplesTexel.rgb;

	}

	// in case this pixel is from a tile that wasn't rendered yet
	if( !isTileRendered ) {
		
		gl_FragColor = vec4( undoColorTransform( accumulatedSamplesTexel.rgb ), 0.05);

		return;

	}

	float tileFactor = max( 0.5, 1.0 - ( tileCount - 1.0 ) * 0.025 );

	float m = ( 1.0 - min( movement * 2.0, 1.0 ) * ( 1.0 - temporalResolveMix ) ) * tileFactor - ( samples - 1.0 ) * 0.0025 - 0.025;

	m = clamp( m, 0.0, 1.0 );

	outputColor = accumulatedSamplesTexel.rgb * m + samplesTexel.rgb * ( 1.0 - m );

	// alpha will be below 1 if the pixel is "new" (e.g. it became disoccluded recently)
	// so make the final color blend more towards the new pixel
	if( alpha < 1.0 ) {
		
		float correctionMix = min( movement, 0.5 ) * newSamplesCorrection;
		outputColor = mix( outputColor, samplesTexel.rgb, correctionMix );

	}

	outputColor = undoColorTransform( outputColor );

    gl_FragColor = vec4( outputColor, alpha );
}
`;
