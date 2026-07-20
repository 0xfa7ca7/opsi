import { describe, expect, it } from "vitest";
import {
  buildWfsUrl,
  parseWfsCapabilities,
  parseWfsCount,
  parseWfsException,
  parseWfsSchema,
} from "../src/wfs/index.js";

describe("bounded WFS protocol", () => {
  it("builds version-correct GetFeature parameters and replaces unsafe inherited values", () => {
    const url = buildWfsUrl("https://example.test/wfs?SERVICE=x&request=Delete&count=99", {
      version: "2.0.0",
      request: "GetFeature",
      layer: "SI.GURS.KN:STAVBE",
      limit: 5,
      startIndex: 0,
      properties: ["EID_STAVBA"],
      outputFormat: "csv",
    });
    expect(url.searchParams.getAll("service")).toEqual(["WFS"]);
    expect(url.searchParams.getAll("request")).toEqual(["GetFeature"]);
    expect(url.searchParams.get("typeNames")).toBe("SI.GURS.KN:STAVBE");
    expect(url.searchParams.get("count")).toBe("5");
    expect(url.searchParams.get("propertyName")).toBe("EID_STAVBA");
    const legacy = buildWfsUrl("https://example.test/wfs", {
      version: "1.1.0",
      request: "GetFeature",
      layer: "roads",
      limit: 2,
    });
    expect(legacy.searchParams.get("typeName")).toBe("roads");
    expect(legacy.searchParams.get("maxFeatures")).toBe("2");
    const legacyFilter = buildWfsUrl("https://example.test/wfs", {
      version: "1.1.0",
      request: "GetFeature",
      layer: "roads",
      filters: { id: 2 },
    }).searchParams.get("filter");
    expect(legacyFilter).toContain('xmlns:ogc="http://www.opengis.net/ogc"');
    expect(legacyFilter).toContain("<ogc:PropertyName>id</ogc:PropertyName>");
    expect(legacyFilter).not.toContain("fes:");
  });

  it.each(["https://user:pass@example.test/wfs", "https://example.test/wfs#fragment"])(
    "rejects unsafe base URL %s",
    (base) => {
      expect(() =>
        buildWfsUrl(base, { version: "2.0.0", request: "GetCapabilities" }),
      ).toThrowError(expect.objectContaining({ code: "WFS_URL_INVALID" }));
    },
  );

  it("parses capabilities, XSD fields, counts, and exceptions", () => {
    const capabilities = parseWfsCapabilities(`<?xml version="1.0"?>
      <wfs:WFS_Capabilities xmlns:wfs="http://www.opengis.net/wfs/2.0" version="2.0.0">
        <ows:OperationsMetadata xmlns:ows="http://www.opengis.net/ows/1.1"><ows:Operation name="GetFeature"/></ows:OperationsMetadata>
        <wfs:FeatureTypeList><wfs:FeatureType><wfs:Name>si:roads</wfs:Name><wfs:Title>Roads</wfs:Title>
        <wfs:DefaultCRS>urn:ogc:def:crs:EPSG::3794</wfs:DefaultCRS><wfs:OtherCRS>EPSG:4326</wfs:OtherCRS></wfs:FeatureType></wfs:FeatureTypeList>
      </wfs:WFS_Capabilities>`);
    expect(capabilities).toMatchObject({
      version: "2.0.0",
      operations: ["GetFeature"],
      layers: [
        {
          name: "si:roads",
          title: "Roads",
          defaultCrs: "urn:ogc:def:crs:EPSG::3794",
          otherCrs: ["EPSG:4326"],
        },
      ],
    });
    expect(
      parseWfsSchema(
        `<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema"><xsd:element name="roads" type="tns:roadsType"/><xsd:complexType name="roadsType"><xsd:sequence><xsd:element name="id" type="xsd:long" minOccurs="0"/><xsd:element name="name" type="xsd:string"/></xsd:sequence></xsd:complexType></xsd:schema>`,
        "roads",
      ),
    ).toEqual([
      { name: "id", type: "xsd:long", nullable: true },
      { name: "name", type: "xsd:string", nullable: false },
    ]);
    expect(parseWfsCount(`<wfs:FeatureCollection xmlns:wfs="x" numberMatched="42"/>`)).toBe(42);
    expect(
      parseWfsException(
        `<ows:ExceptionReport xmlns:ows="x"><ows:Exception exceptionCode="InvalidParameterValue"><ows:ExceptionText>bad layer</ows:ExceptionText></ows:Exception></ows:ExceptionReport>`,
      ),
    ).toMatchObject({
      code: "SERVICE_EXCEPTION",
      context: { serviceCode: "InvalidParameterValue" },
    });
  });

  it("rejects DTD input and oversized XML", () => {
    expect(() => parseWfsCapabilities("<!DOCTYPE x><x/>")).toThrowError(
      expect.objectContaining({ code: "INVALID_WFS_RESPONSE" }),
    );
    expect(() => parseWfsCapabilities(`<x>${"a".repeat(1024)}</x>`, 64)).toThrowError(
      expect.objectContaining({ code: "WFS_RESPONSE_TOO_LARGE" }),
    );
  });
});
