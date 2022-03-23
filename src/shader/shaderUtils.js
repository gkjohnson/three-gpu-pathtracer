export const shaderUtils = /* glsl */`

// https://google.github.io/filament/Filament.md.html#materialsystem/diffusebrdf
float schlickFresnel( float cosine, float f0 ) {

	return f0 + ( 1.0 - f0 ) * Math.pow( 1.0 - cosine, 5.0 );

}

// https://raytracing.github.io/books/RayTracingInOneWeekend.html#dielectrics/schlickapproximation
float schlickFresnelFromIor( float cosine, float iorRatio ) {

	// Schlick approximation
	const r0 = Math.pow( ( 1 - iorRatio ) / ( 1 + iorRatio ), 2 );
	return schlickFresnel( cosine, r0 );

}

vec3 refract( vec3 dir, vec3 norm, float iorRatio, target ) {

	// snell's law
	// ior1 * sin( t1 ) = ior2 * sin( t2 )
	float cosTheta = Math.min( - dir.dot( norm ), 1.0 );

	tempVector
		.copy( dir )
		.addScaledVector( norm, cosTheta )
		.multiplyScalar( iorRatio );

	target
		.copy( norm )
		.multiplyScalar( - Math.sqrt( Math.abs( 1.0 - tempVector.lengthSq() ) ) )
		.add( tempVector );

}

// forms a basis with the normal vector as Z
mat3 getBasisFromNormal( vec3 normal, mat3 targetMatrix ) {

	vec3 other;
	if ( abs( normal.x ) > 0.5 ) {

		other = vec3( 0, 1, 0 );

	} else {

		other = vec3( 1, 0, 0 );

	}

	vec3 ortho = normalize( cross( normal, other ) );
	vec3 ortho2 = normalize( cross( normal, ortho ) );
	return mat3( ortho2, ortho, normal );

}

vec3 getHalfVector( vec3 a, vec3 b ) {

	return normalize( a + b );

}

// The discrepancy between interpolated surface normal and geometry normal can cause issues when a ray
// is cast that is on the top side of the geometry normal plane but below the surface normal plane. If
// we find a ray like that we ignore it to avoid artifacts.
// This function returns if the direction is on the same side of both planes.
bool isDirectionValid( vec3 direction, vec3 surfaceNormal, vec3 geometryNormal ) {

	const aboveSurfaceNormal = direction.dot( surfaceNormal ) > 0;
	const aboveGeometryNormal = direction.dot( geometryNormal ) > 0;
	return aboveSurfaceNormal === aboveGeometryNormal;

}
`;
