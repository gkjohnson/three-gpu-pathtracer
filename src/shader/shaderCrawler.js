export const shaderCrawler = /* glsl */`

// TODO:
// - metalness has a specular issue
// - roughness has a specular issue

vec3 GetSpecColor( SurfaceRec surfaceRec ) {

	float eta = surfaceRec.eta;
	float F0 = ( 1.0 - eta ) / ( 1.0 + eta );
	vec3 specCol = mix( F0 * F0 * surfaceRec.specularColor, surfaceRec.color, surfaceRec.metalness );
	return specCol;

}

vec3 SampleGGXVNDF( vec3 V, float ax, float ay, float r1, float r2 ) {

	vec3 Vh = normalize( vec3( ax * V.x, ay * V.y, V.z ) );

	float lensq = Vh.x * Vh.x + Vh.y * Vh.y;
	vec3 T1 = lensq > 0.0 ? vec3( - Vh.y, Vh.x, 0 ) * ( 1.0 / sqrt( lensq ) ) : vec3( 1, 0, 0 );
	vec3 T2 = cross( Vh, T1 );

	float r = sqrt( r1 );
	float phi = 2.0 * PI * r2;
	float t1 = r * cos( phi );
	float t2 = r * sin( phi );
	float s = 0.5 * ( 1.0 + Vh.z );
	t2 = ( 1.0 - s ) * sqrt( 1.0 - t1 * t1 ) + s * t2;

	vec3 Nh = t1 * T1 + t2 * T2 + sqrt( max( 0.0, 1.0 - t1 * t1 - t2 * t2 ) ) * Vh;

	return normalize( vec3( ax * Nh.x, ay * Nh.y, max( 0.0, Nh.z ) ) );

}

float SmithGAniso( float NDotV, float VDotX, float VDotY, float ax, float ay ) {

	float a = VDotX * ax;
    float b = VDotY * ay;
    float c = NDotV;
    return ( 2.0 * NDotV ) / ( NDotV + sqrt( a * a + b * b + c * c ) );

}

float GTR2Aniso( float NDotH, float HDotX, float HDotY, float ax, float ay ) {

    float a = HDotX / ax;
    float b = HDotY / ay;
    float c = a * a + b * b + NDotH * NDotH;
    return 1.0 / ( PI * ax * ay * c * c );

}

float EvalSpecReflection( SurfaceRec surfaceRec, vec3 V, vec3 L, vec3 H, out vec3 color ) {

	color = vec3( 0.0 );
    float pdf = 0.0;
    if ( L.z <= 0.0 ) {

        return pdf;

	}

	float eta = surfaceRec.eta;
	vec3 specCol = GetSpecColor( surfaceRec ); // surfaceRec.specularColor;
	float ay = surfaceRec.filteredRoughness;
	float ax = surfaceRec.filteredRoughness;

    float FM = disneyFresnel( surfaceRec, V, L, H ); //dot( L, H ), dot( V, H ) );
    vec3 F = mix( specCol, vec3( 1.0 ), FM );
    float D = GTR2Aniso( H.z, H.x, H.y, ax, ay );
    float G1 = SmithGAniso( abs( V.z ), V.x, V.y, ax, ay );
    float G2 = G1 * SmithGAniso( abs( L.z ), L.x, L.y, ax, ay );

    pdf = G1 * D / ( 4.0 * V.z );
    color = F * D * G2 / ( 4.0 * L.z * V.z );

	return pdf;

}

`;
