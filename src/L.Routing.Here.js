(function () {
	'use strict';

	var L = require('leaflet');
	var corslite = require('corslite');
	var haversine = require('haversine');

	L.Routing = L.Routing || {};

	L.Routing.Here = L.Class.extend({
		options: {
			serviceUrl: 'https://route.api.here.com/routing/7.2/calculateroute.json',
			timeout: 30 * 1000,
			alternatives: 0,
			mode: 'fastest;car;',
			generateMode: false,
			urlParameters: {}
		},

		initialize: function (appId, appCode, options) {
			this._appId = appId;
			this._appCode = appCode;
			L.Util.setOptions(this, options);
		},

		route: function (waypoints, callback, context, options) {
			var timedOut = false,
				wps = [],
				url,
				timer,
				wp,
				i;

			options = options || {};
			url = this.buildRouteUrl(waypoints, options);

			timer = setTimeout(function () {
				timedOut = true;
				callback.call(context || callback, {
					status: -1,
					message: 'Here request timed out.'
				});
			}, this.options.timeout);

			// for (i = 0; i < waypoints.length; i++) {
			// 	wp = waypoints[i];
			// 	wps.push({
			// 		latLng: wp.latLng,
			// 		name: wp.name,
			// 		options: wp.options
			// 	});
			// }

			// Let reference here, problem when reverse geocoding point took to long, didnt have name here
			wps = waypoints;

			return corslite(url, L.bind(function (err, resp) {
				var data;

				clearTimeout(timer);
				if (!timedOut) {
					if (!err) {
						data = JSON.parse(resp.responseText);
						this._routeDone(data, wps, callback, context);
					} else {
						callback.call(context || callback, {
							status: -1,
							message: 'HTTP request failed: ' + err,
							type: err.type
						});
					}
				}
			}, this));
		},

		_routeDone: function (response, inputWaypoints, callback, context) {
			var alts = [],
				waypoints,
				waypoint,
				coordinates,
				i, j, k,
				instructions,
				distance,
				time,
				leg,
				maneuver,
				startingSearchIndex,
				instruction,
				path;

			context = context || callback;
			if (!response.response.route) {
				callback.call(context, {
					// TODO: include all errors
					status: response.type,
					message: response.details
				});
				return;
			}

			for (i = 0; i < response.response.route.length; i++) {
				path = response.response.route[i];
				coordinates = this._decodeGeometry(path.shape);
				startingSearchIndex = 0;

				instructions = [];
				time = 0;
				distance = 0;
				for (j = 0; j < path.leg.length; j++) {
					leg = path.leg[j];
					for (k = 0; k < leg.maneuver.length; k++) {
						maneuver = leg.maneuver[k];
						distance += maneuver.length;
						time += maneuver.travelTime;
						instruction = this._convertInstruction(maneuver, coordinates, startingSearchIndex);
						instructions.push(instruction);
						startingSearchIndex = instruction.index;
					}
				}

				waypoints = [];
				for (j = 0; j < path.waypoint.length; j++) {
					waypoint = path.waypoint[j];
					waypoints.push(new L.LatLng(
						waypoint.mappedPosition.latitude,
						waypoint.mappedPosition.longitude));
				}

				alts.push({
					name: (path.label || []).join(', '),
					coordinates: coordinates,
					instructions: instructions,
					summary: {
						totalDistance: distance,
						totalTime: time,
					},
					inputWaypoints: inputWaypoints,
					waypoints: waypoints
				});
			}

			callback.call(context, null, alts);
		},

		_decodeGeometry: function (geometry) {
			var latlngs = new Array(geometry.length),
				coord,
				i;
			for (i = 0; i < geometry.length; i++) {
				coord = geometry[i].split(',');
				latlngs[i] = ([parseFloat(coord[0]), parseFloat(coord[1])]);
			}

			return latlngs;
		},

		buildRouteUrl: function (waypoints, options) {
			var locs = [],
				i,
				alternatives,
				baseUrl;

			for (i = 0; i < waypoints.length; i++) {
				locs.push('waypoint' + i + '=geo!' + waypoints[i].latLng.lat + ',' + waypoints[i].latLng.lng);
			}

			alternatives = this.options.alternatives;
			baseUrl = this.options.serviceUrl + '?' + locs.join('&');

			return baseUrl + L.Util.getParamString(L.extend({
				instructionFormat: 'text',
				app_code: this._appCode,
				app_id: this._appId,
				representation: 'navigation',
				mode: this._buildRouteMode(this.options),
				alternatives: alternatives
			}, this.options.urlParameters, this._attachTruckRestrictions(this.options)), baseUrl);
		},

		_buildRouteMode: function (options) {
			if (options.generateMode === false) {
				return options.mode;
			}
			var modes = [];
			var avoidness = [];
			var avoidnessLevel = '-3'; //strictExclude

			if (options.hasOwnProperty('routeRestriction')
				&& options.routeRestriction.hasOwnProperty('routeType')) {
				modes.push(options.routeRestriction.routeType);
			}
			else {
				modes.push('fastest');
			}

			if (options.hasOwnProperty('routeRestriction')
				&& options.routeRestriction.hasOwnProperty('vehicleType')) {
				modes.push(options.routeRestriction.vehicleType);
			} else {
				modes.push('car');
			}

			if (options.hasOwnProperty('routeRestriction')
				&& options.routeRestriction.hasOwnProperty('trafficMode')
				&& options.routeRestriction.trafficMode === true) {
				modes.push('traffic:enabled');
			} else {
				modes.push('traffic:disabled');
			}

			if (options.hasOwnProperty('routeRestriction')
				&& options.routeRestriction.hasOwnProperty('avoidHighways')
				&& options.routeRestriction.avoidHighways === true) {
				avoidness.push('motorway:' + avoidnessLevel);
			}

			if (options.hasOwnProperty('routeRestriction')
				&& options.routeRestriction.hasOwnProperty('avoidTolls')
				&& options.routeRestriction.avoidTolls === true) {
				avoidness.push('tollroad:' + avoidnessLevel);
			}

			if (options.hasOwnProperty('routeRestriction')
				&& options.routeRestriction.hasOwnProperty('avoidFerries')
				&& options.routeRestriction.avoidFerries === true) {
				avoidness.push('boatFerry:' + avoidnessLevel);
			}

			modes.push(avoidness.join(','));
			return modes.join(';');
		},

		_attachTruckRestrictions: function (options) {
			var _truckRestrictions = {};
			var allowedParameters = ['height', 'width', 'length', 'limitedWeight', 'weightPerAxle', 'shippedHazardousGoods', 'engineType', 'trailersCount'];

			if (!options.hasOwnProperty('routeRestriction')
				|| !options.hasOwnProperty('truckRestriction')
				|| !options.routeRestriction.hasOwnProperty('vehicleType')
				|| options.routeRestriction.vehicleType !== 'truck') {
				return _truckRestrictions;
			}

			if (options.truckRestriction.hasOwnProperty('shippedHazardousGoods')) {
				if (Array.isArray(options.truckRestriction['shippedHazardousGoods'])) {
					options.truckRestriction['shippedHazardousGoods'] = options.truckRestriction['shippedHazardousGoods'].join();
				}
			}

			for (var property in options.truckRestriction) {
				if (!options.truckRestriction.hasOwnProperty(property)
					|| allowedParameters.indexOf(property) === -1
					|| options.truckRestriction[property] === ''
					|| options.truckRestriction[property] === null) {
					continue;
				}

				var _value = options.truckRestriction[property];

				if (property === 'engineType') {
					property = 'vehicleType';
				}
				_truckRestrictions[property] = _value;
			}
			_truckRestrictions.truckType = 'truck';


			return _truckRestrictions;
		},

		_convertInstruction: function (instruction, coordinates, startingSearchIndex) {
			var i,
				distance,
				closestDistance = 0,
				closestIndex = -1,
				coordinate = instruction.position;
			if (startingSearchIndex < 0) {
				startingSearchIndex = 0;
			}
			for (i = startingSearchIndex; i < coordinates.length; i++) {
				distance = haversine(coordinate, { latitude: coordinates[i][0], longitude: coordinates[i][1] });
				if (distance < closestDistance || closestIndex == -1) {
					closestDistance = distance;
					closestIndex = i;
				}
			}
			return {
				text: instruction.instruction,//text,
				distance: instruction.length,
				time: instruction.travelTime,
				index: closestIndex,
				type: instruction.action,
				road: instruction.roadName
			};
		}
	});

	L.Routing.here = function (appId, appCode, options) {
		return new L.Routing.Here(appId, appCode, options);
	};

	module.exports = L.Routing.Here;
})();
